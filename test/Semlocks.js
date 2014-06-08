/*
 * Semlocks
 * Copyright 2014 Tom Frost
 */

var should = require('should'),
	semlocks = require('../lib/Semlocks'),
	inst;

describe("Semaphore", function() {
	beforeEach(function() {
		inst = new semlocks.Semlocks();
	});
	it("should only assign one lock at a time", function(done) {
		var locked = false,
			firstHit = false;
		inst.acquire('test', function(err, releaseAll) {
			should.not.exist(err);
			locked.should.equal(false);
			locked = true;
			firstHit.should.equal(false);
			firstHit = true;
			inst.acquire('test', function(err) {
				should.not.exist(err);
				locked.should.equal(false);
				firstHit.should.equal(true);
				done();
			});
			setTimeout(function() {
				releaseAll();
				locked = false;
			}, 5);
		});
	});
	it("should allow sems to be capped higher than 1", function(done) {
		var locks = 0;
		inst.setMaxLocks('foo', 2);
		inst.acquire('foo', function(err, releaseAll) {
			should.not.exist(err);
			locks++;
			locks.should.equal(1);
			inst.acquire('foo', function(err, releaseAll) {
				should.not.exist(err);
				locks++;
				locks.should.equal(2);
				inst.acquire('foo', function(err) {
					should.not.exist(err);
					locks++;
					locks.should.equal(2);
					done();
				});
			});
			setTimeout(function() {
				releaseAll();
				locks--;
			});
		});
	});
	it("should allow caps to be cleared", function(done) {
		var locked = false;
		inst.setMaxLocks('foo', 2);
		inst.acquire('foo', function(err, releaseAll) {
			should.not.exist(err);
			locked = true;
			inst.setMaxLocks('foo', null);
			inst.acquire('foo', function(err) {
				should.not.exist(err);
				locked.should.equal(false);
				done();
			});
			setTimeout(function() {
				locked = false;
				releaseAll();
			}, 5);
		});
	});
	it("should auto-release sems with no callback args", function(done) {
		var called = false;
		inst.acquire('foo', function(err) {
			should.not.exist(err);
			called.should.equal(false);
			called = true;
		});
		inst.acquire('foo', function(err) {
			should.not.exist(err);
			called.should.equal(true);
			done();
		});
	});
	it("should acquire arrays of sems", function(done) {
		var foo = false,
			bar = false;
		inst.acquire(['foo', 'bar'], function(err, releaseAll) {
			should.not.exist(err);
			inst.acquire('foo', function(err) {
				should.not.exist(err);
				foo = true;
			});
			inst.acquire('bar', function(err) {
				should.not.exist(err);
				bar = true;
			});
			inst.acquire(['foo', 'bar'], function(err) {
				should.not.exist(err);
				foo.should.equal(true);
				bar.should.equal(true);
				done();
			});
			setTimeout(releaseAll, 5);
		});
	});
	it("should allow sems to be acquired instantly only", function(done) {
		inst.acquire('foo', {instant: true}, function(err) {
			should.not.exist(err);
			done();
		});
	});
	it("should send error when sems can't acquire instantly", function(done) {
		var opts = {instant: true};
		inst.acquire('foo', opts, function(err, releaseAll) {
			should.not.exist(err);
			inst.acquire('foo', opts, function(err) {
				should.exist(err);
				releaseAll();
				done();
			});
		});
	});
	it("should send error for instant when in the same tick", function(done) {
		inst.acquire('foo', function(err) {
			should.not.exist(err);
		});
		inst.acquire('foo', {instant: true}, function(err) {
			should.exist(err);
			done();
		});
	});
	it("should return a handle to cancel the request", function(done) {
		var hit = false;
		inst.acquire('foo', function(err, releaseAll) {
			should.not.exist(err);
			var handle = inst.acquire('foo', function(err) {
				hit = true;
			});
			should.exist(handle);
			inst.cancel(handle);
			releaseAll();
			setTimeout(function() {
				hit.should.equal(false);
				done();
			}, 5);
		});
	});
	it("should pass an error when canceling with an error", function(done) {
		var hit = false;
		inst.acquire('foo', function(err, releaseAll) {
			should.not.exist(err);
			var handle = inst.acquire('foo', function(err) {
				should.exist(err);
				err.should.have.property('message').equal('bar');
				hit = true;
			});
			should.exist(handle);
			inst.cancel(handle, new Error('bar'));
			releaseAll();
			setTimeout(function() {
				hit.should.equal(true);
				done();
			}, 5);
		});
	});
	it("should not pass a cancel error if cb was called", function(done) {
		var hits = 0;
		inst.acquire('foo', function(err, releaseAll) {
			should.not.exist(err);
			var handle = inst.acquire('foo', function(err, releaseAll) {
				should.not.exist(err);
				hits++;
				setTimeout(releaseAll, 10);
			});
			should.exist(handle);
			releaseAll();
			setTimeout(function() {
				inst.cancel(handle, new Error('bar'));
			}, 5);
			setTimeout(function() {
				hits.should.equal(1);
				done();
			}, 15);
		});
	});
	//it("should ")
	it("should release all locks when canceling", function(done) {
		var hit = false;
		inst.acquire('foo', function(err, releaseAll) {
			should.not.exist(err);
			var handle = inst.acquire(['foo', 'bar'], function(err) {
				hit = true;
			});
			inst.acquire(['foo', 'bar'], function(err) {
				should.not.exist(err);
				hit.should.equal(false);
				done();
			});
			inst.cancel(handle);
			releaseAll();
		});
	});
	it("should work correctly with a high wait time", function(done) {
		var hit = false;
		inst.acquire('foo', function(err, releaseAll) {
			should.not.exist(err);
			inst.acquire('foo', {wait: 10}, function(err) {
				should.not.exist(err);
				hit = true;
			});
			setTimeout(releaseAll, 5);
			setTimeout(function() {
				hit.should.equal(true);
				done();
			}, 15);
		});
	});
	it("should fail when wait time is exceeded", function(done) {
		var hit = false;
		inst.acquire('foo', function(err, releaseAll) {
			should.not.exist(err);
			inst.acquire('foo', {wait: 5}, function(err) {
				should.exist(err);
				hit = true;
			});
			setTimeout(function() {
				hit.should.equal(true);
				releaseAll();
				done();
			}, 10);
		});
	});
	it("should work correctly with a high ttl", function(done) {
		var released = false;
		inst.acquire('foo', {ttl: 1000}, function(err, releaseAll) {
			should.not.exist(err);
			inst.acquire('foo', function(err) {
				should.not.exist(err);
				released.should.equal(true);
				done();
			});
			setTimeout(function() {
				released = true;
				releaseAll();
			}, 5);
		});
	});
	it("should auto-release when ttl is reached", function(done) {
		var hit = false;
		inst.acquire('foo', {ttl: 5}, function(err, releaseAll) {
			should.not.exist(err);
			inst.acquire('foo', function(err) {
				should.not.exist(err);
				hit = true;
			});
			setTimeout(function() {
				hit.should.equal(true);
				done();
			}, 10);
		});
	});
	it("should allow sems to be released individually", function(done) {
		var hitFoo = false,
			hitBar = false;
		inst.acquire(['foo', 'bar'], function(err, releaseAll, release) {
			should.not.exist(err);
			inst.acquire('foo', function(err) {
				should.not.exist(err);
				hitFoo = true;
			});
			inst.acquire('bar', function(err) {
				hitBar = true;
			});
			release('foo');
			setTimeout(function() {
				hitFoo.should.equal(true);
				hitBar.should.equal(false);
				done();
			}, 5);
		});
	});
	it("should emit acquire and release events appropriately", function(done) {
		var acquires = 0,
			releases = 0;
		inst.on('acquire:foo', function(handle) {
			should.exist(handle);
			acquires++;
		});
		inst.on('acquire', function(sem, handle) {
			should.exist(sem);
			should.exist(handle);
			if (sem == 'foo') acquires++;
		});
		inst.on('release:foo', function(handle) {
			should.exist(handle);
			releases++;
		});
		inst.on('release', function(sem, handle) {
			should.exist(sem);
			should.exist(handle);
			if (sem == 'foo') releases++;
		});
		inst.acquire(['foo', 'bar'], function(err) {
			should.not.exist(err);
			acquires.should.equal(2);
			releases.should.equal(0);
		});
		setTimeout(function() {
			acquires.should.equal(2);
			releases.should.equal(2);
			done();
		}, 5);
	});
	it("should emit killed event when ttl expires", function(done) {
		var killed = false;
		var handle = inst.acquire('foo', {ttl: 5}, function(err, releaseAll) {
			should.not.exist(err);
			setTimeout(function() {
				killed.should.equal(handle);
				done();
			}, 10);
		});
		inst.on('killed', function(killHandle) {
			killed = killHandle;
		});
	});
	it("should award locks to earlier priorities first", function(done) {
		var hits = 0;
		inst.acquire('foo', function(err, releaseAll) {
			should.not.exist(err);
			inst.acquire('foo', {priority: 3}, function(err, releaseAll) {
				should.not.exist(err);
				hits.should.equal(3);
				hits++;
				releaseAll();
				done();
			});
			inst.acquire('foo', {priority: 2}, function(err, releaseAll) {
				should.not.exist(err);
				hits.should.equal(1);
				hits++;
				releaseAll();
			});
			inst.acquire('foo', {priority: 1}, function(err, releaseAll) {
				should.not.exist(err);
				hits.should.equal(0);
				hits++;
				releaseAll();
			});
			inst.acquire('foo', {priority: 2}, function(err, releaseAll) {
				should.not.exist(err);
				hits.should.equal(2);
				hits++;
				releaseAll();
			});
			releaseAll();
		});
	});
});
