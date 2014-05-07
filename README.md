# Semlocks
Mind-blowingly simple local resource management

Sponsored by [Leadnomics](http://www.leadnomics.com).

## Installation
In your project folder, type:

	npm install semlocks --save

## Usage
### Getting Started

```js
var locks = require('semlocks');

locks.acquire('hello', function(err, releaseAll) {
	console.log('Hello');
	setTimeout(releaseAll, 1000);
});

locks.acquire('hello', function() {
	// Prints a second after 'Hello'
	console.log('World!');
});
```

Locks can be acquired for one or many semaphores at once; just pass an array!

```js
locks.acquire(['hello', 'there'], function(err, releaseAll) {
	console.log('Hello');
	setTimeout(releaseAll, 1000);
});

locks.acquire('there', function() {
	// Prints a second after 'Hello'
	console.log('there,');
});

locks.acquire('hello', function() {
	// Prints a second after 'Hello' and immediately after 'there'
	// ('there' got in line first!)
	console.log('World!');
});
```

Release some locks earlier than others if you're finished with them:

```js
locks.acquire(['hello', 'there'], function(err, releaseAll, release) {
	console.log('Hello');
	setTimeout(function() { release('there'); }, 1000);
	// Calling releaseAll() now is the same as release('hello')
	setTimeout(releaseAll, 2000);
});

locks.acquire('there', function() {
	// Prints a second after 'Hello'
	console.log('there,');
});

locks.acquire('hello', function() {
	// Prints two seconds after 'Hello'
	console.log('World!');
});
```

Specify when you can't wait for a lock:

```js
locks.acquire('hello', function(err, releaseAll) {
	console.log('Hello');
	setTimeout(releaseAll, 1000);
});

locks.acquire('hello', {instant: true}, function(err) {
	// Output: Could not acquire all locks instantly
	console.log(err.message);
});
```

Avoid deadlocks with wait limits and TTLs:

```js
locks.acquire('hello', {wait: 1000, ttl: 2000}, function(err, releaseAll) {
	// This will give us an 'err' if we waited more than 1 second and couldn't
	// get a lock.

	// If we do get a lock and this is called without an 'err', we have 2
	// seconds to finish before 'hello' is forcibly unlocked.  That does not
	// impede the execution of this function, however.
});
```

Bask in convenience:

```js
locks.acquire('hello', function(err) {
	// No 'releaseAll' argument in this callback?  'hello' will be released
	// immediately once the function is complete.
});
```

Allow semaphores to be held multiple times simultaneously:

```js
locks.setMaxLocks('hello', 2);
locks.acquire('hello', function(err, releaseAll) {
	console.log('Hello');
	setTimeout(releaseAll, 1000);
});

locks.acquire('hello', function(err, releaseAll) {
	// Prints immediately after 'Hello' with no wait. 'hello' is held twice!
	console.log('World!');
	setTimeout(releaseAll, 1000);
});
```

Cancel pending locks by grabbing the handle:

```js
var handle = locks.acquire(['hello', 'world'], function(err) {
	console.log('This will never be seen.');
});

locks.cancel(handle);
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
cancel it before the locks are obtained.
- **semaphore** *string|array:* A string or array of strings indicating which
semaphores to lock before executing the callback
- **[options]** *object:* Optionally, an object specifying any of the following
key/value pairs:
	- **wait** *number:* The number of milliseconds to wait for a lock. If this
time limit is reached and the locks have not all been obtained, the callback is
executed with an error argument.
	- **instant** *boolean:* If true, the callback will be called with an error
argument if the locks cannot be immediately obtained.
	- **ttl** *number:* The 'time-to-live': a number of milliseconds that a
callback can take to release all its locks before they are forcibly released
and a 'killed' event is fired.  Note that this does not halt the execution of
the callback.
- **callback** *function:* A callback to be executed when all the locks are
obtained, or when the locks cannot be obtained due to the `wait` or `instant`
options above.  The callback is called in the tick immediately after the
acquisition of the last semaphore, with the following arguments:
	- **err** *Error|null:* An error object, if locks could not be obtained due
to the `wait` or `instant` options.
	- **releaseAll** *function:* Releases all currently held locks for this
request.  If this argument is specified in the callback signature, the locks
MUST be manually released in order for them to be acquired by other requests.
The only exception is if the `ttl` option is specified, but that should not be
utilized for regular operation.
	- **release(semaphore)** *function:* Releases the specified semaphore. This
is useful if more than one semaphore was acquired, and the callback finishes
with one before others.

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

#### setMaxLocks(semaphore, max)
Sets the maximum number of times the specified semaphore can be simultaneously
locked. By default, all semaphores are exclusive (max 1).
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
