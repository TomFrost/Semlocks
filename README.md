# Semlocks [![Build Status](https://travis-ci.org/TomFrost/Semlocks.svg?branch=master)](https://travis-ci.org/TomFrost/Semlocks)
Mind-blowingly simple local resource management

Sponsored by [Leadnomics](http://www.leadnomics.com).

## Installation
In your project folder, type:

	npm install semlocks --save

## Usage
### Getting Started

```js
var locks = require('semlocks');

locks.acquire('hello', function(err, release) {
	console.log('Hello');
	setTimeout(release, 1000);
});

locks.acquire('hello', function(err, release) {
	// Prints a second after 'Hello'
	console.log('World!');
	release();
});
```

Locks can be acquired for one or many semaphores at once; just pass an array!

```js
locks.acquire(['hello', 'there'], function(err, release) {
	console.log('Hello');
	setTimeout(release, 1000);
});

locks.acquire('hello', function(err, release) {
	// Prints a second after 'Hello'
	console.log('there,');
	release();
});

locks.acquire('there', function(err, release) {
	// Prints a second after 'Hello' and immediately after 'there,'
	console.log('World!');
	release();
});
```

Release some locks earlier than others if you're finished with them:

```js
locks.acquire(['hello', 'there'], function(err, release) {
	console.log('Hello');
	setTimeout(function() { release('there'); }, 1000);
	// Calling release() now is the same as release('hello')
	setTimeout(release, 2000);
});

locks.acquire('there', function(err, release) {
	// Prints a second after 'Hello'
	console.log('there,');
	release();
});

locks.acquire('hello', function(err, release) {
	// Prints two seconds after 'Hello'
	console.log('World!');
	release();
});
```

Specify when you can't wait for a lock:

```js
locks.acquire('hello', function(err, release) {
	console.log('Hello');
	setTimeout(release, 1000);
});

locks.acquire('hello', {instant: true}, function(err, release) {
	// Output: Could not acquire all locks instantly
	console.log(err.message);
});
```

Avoid deadlocks with wait limits and TTLs:

```js
locks.acquire('hello', {wait: 1000, ttl: 2000}, function(err, release) {
	// This will give us an 'err' if we waited more than 1 second and couldn't
	// get a lock.

	// If we do get a lock and this is called without an 'err', we have 2
	// seconds to finish before 'hello' is forcibly unlocked.  That does not
	// impede the execution of this function, however.
});
```

Allow semaphores to be held multiple times simultaneously:

```js
locks.setMaxLocks('hello', 2);
locks.acquire('hello', function(err, release) {
	console.log('Hello');
	setTimeout(release, 1000);
});

locks.acquire('hello', function(err, release) {
	// Prints immediately after 'Hello' with no wait. 'hello' is held twice!
	console.log('World!');
	setTimeout(release, 1000);
});
```

Jump in line with priorities:

```js
locks.acquire('hello', function(err, release) {
	console.log('Hello');
	locks.acquire('hello', {priority: 2}, function(err, release) {
    	console.log('World!');
    	release();
    });
    locks.acquire('hello', {priority: 1}, function(err, release) {
    	// Prints between "Hello" and "World!". The priority 1 jumps ahead of
    	// the priority 2 in line!
    	console.log('there,');
    	release();
    });
	release();
});
```

Cancel pending locks by grabbing the handle:

```js
var handle = locks.acquire(['hello', 'world'], function(err, release) {
	console.log('This will never be seen.');
});

locks.cancel(handle);
```

You can use the handle to release locks, too:

```js
var handle = locks.acquire('hello', function(err) {
    // Do something
});

setTimeout(function() {
	locks.release(handle);
}, 1000);
```

### New Instances
Need more than one independent group of semaphores?

```js
var Semlocks = require('semlocks').Semlocks;

var locks = new Semlocks();
var moreLocks = new Semlocks();
```

### API
#### acquire(semaphore, [options], callback)
Requests the provided semaphore(s) and calls the callback when they're all
locked.  **Returns** a numeric handle for this request, which can be used to
cancel it before the locks are obtained.  **Note** that the callback is called
in the tick immediately following the tick in which the last semaphore was
locked, in order to ensure the handle is returned and available when the
callback executes.
- **semaphore** *string|array:* A string or array of strings indicating which
semaphores to lock before executing the callback
- **[options]** *object:* Optionally, an object specifying any of the following
key/value pairs:
	- **wait** *number:* The number of milliseconds to wait for a lock. If this
time limit is reached and the locks have not all been obtained, the callback is
executed with an error argument. *Default: unbounded*
	- **instant** *boolean:* If true, the callback will be called with an error
argument if the locks cannot be immediately obtained. *Default: false*
	- **ttl** *number:* The 'time-to-live': a number of milliseconds that a
callback can take to release all its locks before they are forcibly released
and a 'killed' event is fired.  Note that this does not halt the execution of
the callback. *Default: unbounded*
	- **priority** *number:* The priority of this request.  Locks are awarded
in priority order, with lower values coming first and higher values coming only
after lower values have been serviced.  Equal priorities are awarded in the
order in which they were requested.  *Default: 2*
- **[callback]** *function:* A callback to be executed when all the locks are
obtained, or when the locks cannot be obtained due to the `wait` or `instant`
options above.  The callback is called in the tick immediately after the
acquisition of the last semaphore, with the following arguments:
	- **err** *Error|null:* An error object, if locks could not be obtained due
to the `wait` or `instant` options.
	- **release([semaphore])** *function:* Releases the specified semaphore or
array of semaphores.  If no semaphore is provided, all semaphores belonging
to this lock request are released.

#### cancel(handle, [err])
Forcibly releases any currently held locks for the specified handle, and
removes it from the waiting lists for any locks it requested and has not yet
acquired.  This can be called for handles regardless of whether their callback
has been executed or not.
- **handle** *number:* The handle of the request to be canceled, as it was
returned by the `acquire` function.
- **[err]** *Error:* An error object. If specified, this will be passed to the
callback function if it's not yet been executed.  Otherwise, the callback
function will not be called.

#### forceRelease(semaphore)
Forcibly releases all locks for the given semaphore by cycling through all
handles currently holding a lock and calling **release()** for each.  Note
that, at the end of the call, the lock may be held by other requests that were
waiting for this semaphore.  To prevent the lock from being held again, call 
**setMaxLocks()** to set the available locks to 0 first.
- **semaphore** *string:* A string representing the semaphore to be forcibly
released.

#### getLocks()
Gets a object mapping of all currently held semaphore names to the number of
currently held locks on that semaphore.  Note that this object is a snapshot
only, and will not auto-update as more locks are acquired and released.

#### getMaxLocks(semaphore)
Gets the currently set max locks for a given semaphore.
- **semaphore** *string:* A string representing the semaphore whose max should
be retrieved.

#### release(handle, [semaphore])
Releases all or some of a request's currently held semaphores.
- **handle** *number:* The handle of the request that owns the locks to be
released.
- **[semaphore]** *string|array:* A semaphore or array of semaphores to be
released. If omitted, all semaphores owned by this handle will be released.

#### setMaxLocks(semaphore, max)
Sets the maximum number of times the specified semaphore can be simultaneously
locked. By default, all semaphores are exclusive (max of 1).  Note that 0 can
be used to prevent a semaphore from being acquired until the max is changed.
Raising the maximum will automatically trigger locks to be granted to the
appropriate number of queued requests for this semaphore.
- **semaphore** *string:* A string representing the semaphore whose max should
be changed.
- **max** *number|null:* The number of simultaneous locks for this semaphore.
If null or <1, the max will revert to its default of 1.

### Events
Semlocks is an EventEmitter that fires the following events:

#### acquire (semaphore, handle)
Fires every time a lock is acquired by a new handle.
- **semaphore** *string:* The name of the semaphore that was locked
- **handle** *number:* The handle of the request that was granted the lock

#### acquire:SEMAPHORE (handle)
Fires every time "SEMAPHORE" (replaced with the name of the semaphore) is
granted to a new handle.
- **handle** *number:* The handle of the request that was granted the lock

#### release (semaphore, handle)
Fires every time a lock is released by a handle.
- **semaphore** *string:* The name of the semaphore that was released
- **handle** *number:* The handle of the request that released the lock

#### release:SEMAPHORE (handle)
Fires every time "SEMAPHORE" (replaced with the name of the semaphore) is
released.
- **handle** *number:* The handle of the request that released the lock

#### killed (handle)
Fires when locks are forcibly released from a handle because that request's TTL
was reached.
- **handle** *number:* The handle of the request that was killed

## Testing
Testing is easy! Just run the following from the project root:

    npm test

## License
Semlocks is distributed under the MIT license.

## Credits
Semlocks was created by Tom Frost at Leadnomics in 2014.
