/*
 * Semlocks
 * Copyright 2014 Tom Frost
 */

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
};
util.inherits(Semlocks, events.EventEmitter);

/**
 * Acquires semaphore locks and calls a callback when they are obtained.
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
 * @param {function} cb A callback to be executed when all the locks are
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
		handle = this._curId++,
		noninstant = false;
	if (typeof opts == 'function') {
		cb = opts;
		opts = {};
	}
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
			req.cb(err);
		}
		delete this._reqs[handle];
	}
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
 * Sets the maximum number of times the specified semaphore can be
 * simultaneously locked. By default, all semaphores are exclusive (max 1).
 * @param {string} sem A string representing the semaphore whose max should be
 *      changed.
 * @param {number} cap The number of simultaneous locks for this semaphore.
 *      If null or <1, the max will revert to its default of 1.
 */
Semlocks.prototype.setMaxLocks = function(sem, cap) {
	if (cap > 1)
		this._semCaps[sem] = cap;
	else if (this._semCaps[sem])
		delete this._semCaps[sem];
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
	if (!this._sems[sem] || this._sems[sem].length < this._semCaps[sem]) {
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
