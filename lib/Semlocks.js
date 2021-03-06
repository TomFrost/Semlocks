/*
 * Semlocks
 * Copyright 2014 Tom Frost
 */

/**
 * The default limit at which IDs will wrap around and be reused.  We could
 * use an actual uuid and not worry about this, but in semaphore-heavy
 * applications, those strings use a measurable amount of RAM more than a
 * simple int.  The default is the max unsigned 4-byte int (note that it's
 * dependent on the V8 engine to store that in an optimized fashion).  This
 * will only cause problems if this limit is reached without id 0 being
 * released yet.  Given that Semlocks is not at this time distributed, the risk
 * of that should be immeasurably small.
 * @type {number}
 */
const HANDLE_LIMIT = 4294967295;

var util = require('util'),
	events = require('events');

/**
 * Semlocks manages mutex and shared locks within a single Node.js process.
 * Each new instance manages semaphores totally independently of any other
 * instance.
 * @constructor
 */
var Semlocks = function() {
	this._reqs = {};
	this._semQueues = {};
	this._sems = {};
	this._semCaps = {};
	this._curId = 0;
	this._defaultCap = 1;
};
util.inherits(Semlocks, events.EventEmitter);

/**
 * Acquires semaphore locks and calls a callback when they are obtained.  Note
 * that the callback is called in the tick immediately following the tick in
 * which the last semaphore was locked, in order to ensure the handle is
 * returned and available when the callback executes.
 * @param {string|Array} sems The semaphore, or array of semaphores, to be
 *      locked before calling the callback.
 * @param {{}|function} [opts] An optional set of key/value options.  They are:
 * @param {number} [opts.wait=null] The number of milliseconds to wait for a
 *      lock.  If this time limit is reached and the locks have not all been
 *      obtained, the callback is executed with an error argument.  Default is
 *      unbounded.
 * @param {number} [opts.ttl=null] The 'time-to-live': a number of milliseconds
 *      that a callback can take to release all its locks before they are
 *      forcibly released and a 'killed' event is fired.  Note that this does
 *      not halt the execution of the callback.  Default is unbounded.
 * @param {boolean} [opts.instant=false] If true, the callback will be called
 *      with an error argument if the locks cannot be immediately obtained.
 * @param {number} [opts.priority=2] The priority of this request.  Locks
 *      are awarded in priority order, with lower values coming first and
 *      higher values coming only after lower values have been serviced.  Equal
 *      priorities are awarded in the order in which they were requested.
 * @param {function} [cb] A callback to be executed when all the locks are
 *      obtained, or when the locks cannot be obtained due to the `wait` or
 *      `instant` options above.  The callback is called in the tick
 *      immediately after the acquisition of the last semaphore, with the
 *      following arguments:
 *          - {Error|null} err: An error object, if locks could not be obtained
 *            due to the `wait` or `instant` options.
 *          - {function} release([sem]): Releases all currently held locks for
 *            this request if sem is not specified, or releases only the
 *            specified semaphore if that argument is provided.  The sem
 *            argument can also be an array of semaphore names to be released.
 * @returns {number} A handle allowing this request to be forcibly canceled by
 *      the {@link #cancel} function.
 */
Semlocks.prototype.acquire = function(sems, opts, cb) {
	var self = this,
		handle = this._getNextHandle(),
		noninstant = false;
	if (typeof opts == 'function') {
		cb = opts;
		opts = {};
	}
	if (!opts)
		opts = {};
	if (!util.isArray(sems))
		sems = [sems];
	this._reqs[handle] = {
		remain: sems.length,
		released: 0,
		sems: sems,
		ttl: opts.ttl,
		priority: opts.hasOwnProperty('priority') ? opts.priority : 2,
		cb: cb
	};
	sems.forEach(function(sem) {
		if (!self._requestLock(handle, sem))
			noninstant = true;
	});
	if (noninstant && opts.instant) {
		this._reqs[handle].remain = 0;
		setImmediate(this.cancel.bind(this, handle,
			new Error('Could not acquire all locks instantly')));
	}
	else if (opts.hasOwnProperty('wait') && opts.wait !== null) {
		this._reqs[handle].timeout = setTimeout(this.cancel.bind(this, handle,
			new Error('Failed to acquire all locks within allotted time')),
			opts.wait);
	}
	return handle;
};

/**
 * Cancels any currently open semaphore request by releasing any locks that the
 * request currently holds as well as deleting that request from any semaphore
 * queues.
 * @param {number} handle The handle of the request to be canceled
 * @param {Error} [err] An optional error object to be passed to the request's
 *      callback function, if and only if the callback function has not already
 *      been called.  If omitted, canceling won't trigger the callback to be
 *      called in any case.
 */
Semlocks.prototype.cancel = function(handle, err) {
	var self = this,
		req = this._reqs[handle];
	if (req) {
		req.sems.forEach(function(sem) {
			self._release(handle, sem);
			// Remove this handle from any waiting queues it's in
			if (self._semQueues[sem]) {
				self._semQueues[sem] = self._semQueues[sem].filter(
					function(i) { return i != handle; });
			}
		});
		if (err && !req.called) {
			req.called = true;
			if (req.cb)
				req.cb(err);
		}
		delete this._reqs[handle];
	}
};

/**
 * Forcibly releases all locks for the given semaphore by cycling through all
 * handles currently holding a lock and calling {@link #release} for each.
 * Note that, at the end of the call, the lock may be held by other requests
 * that were waiting for this semaphore.  To prevent the lock from being held
 * again, call {@link #setMaxLocks} to set the available locks to 0 first.
 * @param {string} sem A string representing the semaphore to be forcibly
 *      released
 */
Semlocks.prototype.forceRelease = function(sem) {
	if (this._sems[sem]) {
		// Quick clone of current locks
		var sems = this._sems[sem].map(function(i) { return i; });
		sems.forEach(function(handle) {
			this.release(handle, sem);
		}, this);
	}
};

/**
 * Gets a mapping of all currently held semaphore names to the number of
 * currently held locks on that semaphore.  Note that this object is a snapshot
 * only, and will not auto-update as more locks are acquired and released.
 * @returns {{}} An object mapping semaphore names to the number of currently
 *      held locks.
 */
Semlocks.prototype.getLocks = function() {
	var sems = {};
	for (var sem in this._sems) {
		if (this._sems.hasOwnProperty(sem))
			sems[sem] = this._sems[sem].length;
	}
	return sems;
};

/**
 * Gets the currently set max locks for a given semaphore.  This can be changed
 * for a specific semaphore by calling {@link #setMaxLocks}, or for all other
 * semaphores by calling {@link #setDefaultMaxLocks}.
 * @param {string} [sem] A string representing the semaphore whose max should
 *      be retrieved.  Omit this argument to get the default max.
 * @returns {number} The current cap of simultaneous locks for this semaphore.
 */
Semlocks.prototype.getMaxLocks = function(sem) {
	return this._semCaps.hasOwnProperty(sem) ? this._semCaps[sem] :
		this._defaultCap;
};

/**
 * Releases a held semaphore, or a set of held semaphores, back into the pool.
 * @param {number} [handle] The handle of a request that currently holds one or
 *      more semaphore locks
 * @param {string|Array<string>} [sem] A semaphore or array of semaphores to be
 *      released.  If omitted, all semaphores belonging to the given handle
 *      will be released.
 */
Semlocks.prototype.release = function(handle, sem) {
	// Fail silently if there is no req; cancel was probably called
	if (this._reqs[handle]) {
		if (!sem)
			sem = this._reqs[handle].sems;
		if (util.isArray(sem))
			sem.forEach(this._release.bind(this, handle));
		else
			this._release(handle, sem);
	}
};

/**
 * Sets the maximum number of times that any semaphore can be simultaneously
 * locked, if no explicit cap has been set on it using {@link #setMaxLocks}.
 *
 * If any requests are waiting in the queue for any semaphores without explicit
 * caps, locks will automatically be granted to the appropriate number of
 * waiting requests.
 * @param {number|null} cap The number of simultaneous locks to allow on
 *      semaphores by default.  If null, the max will revert to its default of
 *      1.  If less than 0, 0 will be used.  Note that a cap of 0 means that
 *      no semaphore will be able to be acquired until this is changed, or
 *      until a semaphore-specific max has been set with {@link #setMaxLocks}.
 */
Semlocks.prototype.setDefaultMaxLocks = function(cap) {
	var prev = this._defaultCap;
	if (cap === null)
		this._defaultCap = 1;
	else
		this._defaultCap = Math.max(cap, 0);
	if (this._defaultCap > prev) {
		for (var sem in this._semQueues) {
			if (this._semQueues.hasOwnProperty(sem) &&
					!this._semCaps.hasOwnProperty(sem)) {
				this._grantEmptySlots(sem);
			}
		}
	}
};

/**
 * Sets the maximum number of times the specified semaphore can be
 * simultaneously locked. By default, all semaphores are exclusive (cap=1).
 * This default can be changed in {@link #setDefaultMaxLocks}.
 *
 * If any requests are waiting in the queue for the given semaphore when the
 * max is raised, locks will automatically be granted to the appropriate number
 * of waiting requests.
 * @param {string} sem A string representing the semaphore whose max should be
 *      changed.
 * @param {number|null} cap The number of simultaneous locks for this
 *      semaphore.  If null, the max will revert to its default.  If less than
 *      0, 0 will be used.  Note that a cap of 0 means that the semaphore will
 *      not be able to be acquired until this is changed.
 */
Semlocks.prototype.setMaxLocks = function(sem, cap) {
	if (cap !== null)
		this._semCaps[sem] = Math.max(cap, 0);
	else if (this._semCaps[sem])
		delete this._semCaps[sem];
	this._grantEmptySlots(sem);
};

/**
 * Calls the callback function for a given handle and adds the 'ttlTimer'
 * property to the request object to track the timeout for the ttl, if
 * specified.
 * @param {number} handle The handle whose callback should be called
 * @private
 */
Semlocks.prototype._callCB = function(handle) {
	var req = this._reqs[handle],
		release = this.release.bind(this, handle),
		self = this;
	if (req.ttl) {
		req.ttlTimer = setTimeout(function() {
			self.release(handle);
			self.emit('killed', handle);
		}, req.ttl);
	}
	req.called = true;
	if (req.cb)
		req.cb(null, release);
};

/**
 * Adds a request handle to a semaphore queue, keeping that queue in order by
 * request priority.
 * @param {string} sem The semaphore whose queue should be manipulated
 * @param {number} handle The handle of the request to be added to the sem's
 *      queue.
 * @private
 */
Semlocks.prototype._enqueue = function(sem, handle) {
	if (!this._semQueues[sem])
		this._semQueues[sem] = [];
	var queue = this._semQueues[sem],
		targetPri = this._reqs[handle].priority,
		inserted = false;
	for (var i = 0; i < queue.length; i++) {
		var curPri = this._reqs[queue[i]].priority;
		if (curPri > targetPri) {
			queue.splice(i, 0, handle);
			inserted = true;
			break;
		}
	}
	if (!inserted)
		queue.push(handle);
};

/**
 * Grants locks to queued handles for a given semaphore, if there are available
 * locks for that semaphore.  As locks are granted automatically upon release,
 * this function is only useful when the max locks cap for a certain semaphore
 * has been raised.
 * @param {string} sem The semaphore with empty slots to be filled
 * @private
 */
Semlocks.prototype._grantEmptySlots = function(sem) {
	if (this._semQueues[sem]) {
		var success;
		do {
			success = this._grantLock(this._semQueues[sem][0], sem);
		} while (success && this._semQueues[sem]);
	}
};

/**
 * Gets the next handle ID to be associated with a semaphore request.  This
 * ID is an integer that increments with each call, resetting to zero when it
 * reaches {@link HANDLE_LIMIT}.
 * @returns {number} The next available handle ID
 * @private
 */
Semlocks.prototype._getNextHandle = function() {
	if (this._curId >= HANDLE_LIMIT)
		this._curId = 0;
	return this._curId++;
};

/**
 * Grants a sem lock to a given handle if that semaphore is available, removing
 * that handle from the top of the semaphore's wait queue if applicable. If
 * this is the last semaphore the request was waiting for, the request's
 * callback will be scheduled for execution in the next tick.
 *
 * Emits 'acquire' and 'acquire:SEMAPHORE' events.
 * @param {number} handle The handle to which the lock should be granted
 * @param {string} sem The semaphore to lock
 * @returns {boolean} true if the semaphore was available and was granted;
 *      false if the semaphore was not available and therefore not granted.
 * @private
 */
Semlocks.prototype._grantLock = function(handle, sem) {
	var cap = this.getMaxLocks(sem);
	if ((!this._sems[sem] && cap) ||
			(this._sems[sem] && this._sems[sem].length < cap)) {
		// Push to an array of handles currently holding this sem
		if (!this._sems[sem])
			this._sems[sem] = [];
		this._sems[sem].push(handle);
		// If this handle was waiting in a queue for this sem, shift it out
		if (this._semQueues[sem] && this._semQueues[sem][0] == handle) {
			if (this._semQueues[sem].length == 1)
				delete this._semQueues[sem];
			else
				this._semQueues[sem].shift();
		}
		// If this is the last sem this handle was waiting for, call the cb
		if (!--this._reqs[handle].remain) {
			if (this._reqs[handle].timeout)
				clearTimeout(this._reqs[handle].timeout);
			setImmediate(this._callCB.bind(this, handle));
		}
		this.emit('acquire', sem, handle);
		this.emit('acquire:' + sem, handle);
		return true;
	}
	return false;
};

/**
 * Releases a lock held by the given handle.
 * @param {number} handle The handle of the request that owns the semaphore
 * @param {string} sem The semaphore to be released
 * @returns {boolean} true if the handle owned the semaphore and it was
 *      released; false if it did not and therefore was not released
 * @private
 */
Semlocks.prototype._release = function(handle, sem) {
	var idx = this._sems[sem] ? this._sems[sem].indexOf(handle) : -1;
	if (idx > -1) {
		// Delete the sem if it's no longer held
		if (this._sems[sem].length == 1)
			delete this._sems[sem];
		else
			this._sems[sem].splice(idx, 1);
		// Grant the sem to the next in line
		if (this._semQueues[sem] && this._semQueues[sem].length)
			this._grantLock(this._semQueues[sem][0], sem);
		// Delete the req if we've released all the semaphores
		if (++this._reqs[handle].released == this._reqs[handle].sems.length) {
			if (this._reqs[handle].ttlTimer)
				clearTimeout(this._reqs[handle].ttlTimer);
			delete this._reqs[handle];
		}
		this.emit('release', sem, handle);
		this.emit('release:' + sem, handle);
		return true;
	}
	return false;
};

/**
 * Requests a lock for a certain request handle.  The lock will either be
 * immediately granted via {@link #_grantLock}, or placed in a waiting queue
 * for this semaphore, to be granted once the request(s) ahead of it releases
 * it.
 * @param {number} handle The handle requesting the lock
 * @param {string} sem The semaphore to be locked
 * @returns {boolean} true if the semaphore was successfully locked to the
 *      handle; false if the handle was added to a waiting queue for this
 *      semaphore
 * @private
 */
Semlocks.prototype._requestLock = function(handle, sem) {
	if (this._grantLock(handle, sem))
		return true;
	this._enqueue(sem, handle);
	return false;
};

module.exports = new Semlocks();
module.exports.Semlocks = Semlocks;
module.exports.HANDLE_LIMIT = HANDLE_LIMIT;
