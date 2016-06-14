# reInterval
![](https://travis-ci.org/4rzael/reInterval.svg)

reschedulable setInterval for node.js

###### Note: Work highly inspired by mcollina [retimer](https://github.com/mcollina/retimer)

## example

```js
var reInterval = require('reInterval');

var inter = reInterval(function () {
  console.log('this should be called after 13s');
}, 10 * 1000)

setTimeout(function () {
  inter.reschedule(10 * 1000);
}, 3 * 1000);
```


## API:

### reInterval(callback, interval, args)

This is exactly like setInterval

### interval.reschedule(interval)

This function reset the interval and restart it now.

### interval.clear()

This function clear the interval.

## license

**MIT**
