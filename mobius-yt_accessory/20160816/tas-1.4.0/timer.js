/**
 * Created by ryeubi in KETI on 2015-08-31.
 */

exports.timer = new process.EventEmitter();

setInterval(function() {
    exports.timer.emit('tick');
}, 1000);
