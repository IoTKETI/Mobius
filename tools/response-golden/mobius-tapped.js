'use strict';
// mobius.js 를 띄우되 그 전에 응답 탭을 건다.
//
//   node tools/response-golden/mobius-tapped.js [sqlite|mysql]
//
// cluster.fork() 는 process.argv[1] 을 다시 실행하므로 워커도 이 파일을 거친다.
// 따라서 워커에서도 탭이 걸린다.

process.chdir(require('path').join(__dirname, '..', '..'));

require('./tap').install();
require('../../mobius.js');
