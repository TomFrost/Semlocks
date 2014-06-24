# Semlocks
Mind-blowingly simple local resource management

##ChangeLog

### Development HEAD
- Calling setMaxLocks will now grant locks to queued requests for that
semaphore.

### v1.1.0
- Added forceRelease to release locks without knowing the handle
- Added public getMaxLocks function to retrieve the current cap for a semaphore
- Added support for capping a semaphore at 0 to stop it from being acquired
- Locks can now be acquired without defining a callback function
- Handle IDs are now wrapped around an extremely high cap so they do not grow
infinitely.

### v1.0.0
- Add priority option to allow semaphore requests to jump in line
- Callbacks are now called with just one 'release' function that can be called
without arguments to release all held semaphores, or with a semaphore/array of
semaphores to release a subset of the awarded locks.
- Added public release() call to support releasing semaphores from outside the
initial callback
- Auto-releasing of semaphores if the callback does not contain a release
argument has been removed; behavior was too unpredictable, and with the public
release function that was added, may not be the preferred functionality.
Bonus: This combined with the single release argument in the callback makes
Semlocks promisify much more cleanly!
- Cleaned up documentation in the README

### v0.1.1
- Drop attempted (but already non-functioning) support for pre-0.10.0 version
of node; process.nextTick is too unpredictable
- Documentation updates

### v0.1.0
- **Initial Release**
