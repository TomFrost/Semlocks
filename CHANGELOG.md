# Semlocks
Mind-blowingly simple local resource management

##ChangeLog

### Development HEAD
- Add priority option to allow semaphore requests to jump in line
- Callbacks are now called with just one 'release' function that can be called
without arguments to release all held semaphores, or with a semaphore/array of
semaphores to release a subset of the awarded locks.
- Added public release() call to support releasing semaphores from outside the
initial callback
- Auto-releasing of semaphores if the callback does not contain a release
argument has been removed; behavior is too unpredictable, and with the public
release function that was added, may not be the preferred functionality.
 - Cleaned up documentation in the README

### v0.1.1
- Drop attempted (but already non-functioning) support for pre-0.10.0 version
of node; process.nextTick is too unpredictable
- Documentation updates

### v0.1.0
- **Initial Release**
