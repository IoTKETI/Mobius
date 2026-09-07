'use strict';
/**
 * 리소스 타입별 속성 목록 — resource.js 에서 옮겨 왔다(2026-09-06).
 *
 * 왜 따로 두는가: 관리 콘솔이 "et 를 수정할 수 있는 타입" 을 화면 상수로 들고
 * 있다가 코어와 어긋났다. 코어에서 받으려면 이 목록을 읽어야 하는데,
 * resource.js 는 sgn·responder·타입 핸들러를 통째로 끌고 오는 파일이라 콘솔이
 * require 할 수 없었다. 목록은 순수 데이터다 — 여기 두면 어디서든 읽는다.
 *
 * 전역(create_m_attr_list 등)은 그대로 세운다. resource.js 와 타입 핸들러가
 * 전역 이름으로 읽는다. 옮기면서 그 계약은 건드리지 않았다.
 */

// ── 여기부터 resource.js 113~256 행을 그대로 ──────────────────────────
global.create_m_attr_list = {};
create_m_attr_list.acp = ['pv', 'pvs'];
create_m_attr_list.csr = ['cb', 'csi', 'rr'];
create_m_attr_list.ae = ['api', 'rr'];
create_m_attr_list.cnt = [];
create_m_attr_list.cin = ['con'];
create_m_attr_list.sub = ['nu'];
create_m_attr_list.lcp = ['los'];
create_m_attr_list.grp = ['mnm', 'mid'];
create_m_attr_list.nod = ['ni'];
create_m_attr_list.smd = ['dcrp', 'dsp'];
create_m_attr_list.mms =['soid', 'asd'];

create_m_attr_list.fwr = ['mgd', 'vr', 'fwnnam', 'url', 'ud'];
create_m_attr_list.bat = ['mgd', 'btl', 'bts'];
create_m_attr_list.dvi = ['mgd', 'dlb', 'man', 'mod', 'dty', 'fwv', 'swv', 'hwv'];
create_m_attr_list.dvc = ['mgd', 'can', 'att', 'cas', 'cus'];
create_m_attr_list.rbo = ['mgd'];

create_m_attr_list.fcnt = ['cnd'];
create_m_attr_list['hd_dooLk'] = ['cnd', 'lock'];
create_m_attr_list['hd_bat'] = ['cnd', 'lvl'];
create_m_attr_list['hd_tempe'] = ['cnd', 'curT0'];
create_m_attr_list['hd_binSh'] = ['cnd', 'powerSe'];
create_m_attr_list['hd_fauDn'] = ['cnd', 'sus'];
create_m_attr_list['hd_colSn'] = ['cnd', 'colSn'];
create_m_attr_list['hd_color'] = ['cnd', 'red', 'green', 'blue'];
create_m_attr_list['hd_brigs'] = ['cnd', 'brigs'];

global.create_opt_attr_list = {};
create_opt_attr_list.acp = ['rn', 'et', 'lbl', 'aa', 'at'];
create_opt_attr_list.csr = ['rn', 'acpi', 'et', 'lbl', 'aa', 'at', 'daci', 'cst', 'poa', 'mei', 'tri', 'nl', 'esi', 'srv'];
create_opt_attr_list.ae = ['rn', 'acpi', 'et', 'lbl', 'aa', 'at', 'daci', 'apn', 'poa', 'or', 'nl', 'csz', 'esi', 'srv'];
create_opt_attr_list.cnt = ['rn', 'acpi', 'et', 'lbl', 'aa', 'at', 'daci', 'cr', 'mni', 'mbs', 'mia', 'li', 'or', 'disr'];
create_opt_attr_list.cin = ['rn', 'et', 'lbl', 'aa', 'at', 'daci', 'cr', 'cnf', 'conr', 'or'];
create_opt_attr_list.sub = ['rn', 'acpi', 'et', 'lbl', 'daci', 'cr', 'enc', 'exc', 'gpi', 'nfu', 'bn', 'rl', 'psn', 'pn', 'nsp', 'ln', 'nct', 'nec', 'su'];
create_opt_attr_list.lcp = ['rn', 'acpi', 'et', 'lbl', 'aa', 'at', 'daci', 'lou', 'lot', 'lor', 'lon'];
create_opt_attr_list.grp = ['rn', 'acpi', 'et', 'lbl', 'aa', 'at', 'daci', 'mt', 'macp', 'csy', 'gn'];
create_opt_attr_list.nod = ['rn', 'acpi', 'et', 'lbl', 'aa', 'at', 'daci', 'hcl', 'mgca'];
create_opt_attr_list.smd = ['rn', 'acpi', 'et', 'lbl', 'aa', 'at', 'cr', 'or', 'rels'];
create_opt_attr_list.mms =['rn', 'acpi', 'et', 'lbl', 'aa', 'at', 'stid', 'osd', 'sst'];

create_opt_attr_list.fwr = ['rn', 'acpi', 'et', 'lbl', 'daci', 'objs', 'obps', 'dc', 'cmlk'];
create_opt_attr_list.bat = ['rn', 'acpi', 'et', 'lbl', 'daci', 'objs', 'obps', 'dc', 'cmlk'];
create_opt_attr_list.dvi = ['rn', 'acpi', 'et', 'lbl', 'daci', 'objs', 'obps', 'dc', 'cmlk'];
create_opt_attr_list.dvc = ['rn', 'acpi', 'et', 'lbl', 'daci', 'objs', 'obps', 'dc', 'cmlk', 'ena', 'dis'];
create_opt_attr_list.rbo = ['rn', 'acpi', 'et', 'lbl', 'daci', 'objs', 'obps', 'dc', 'cmlk', 'rbo', 'far'];

create_opt_attr_list.fcnt = ['rn', 'acpi', 'et', 'lbl', 'aa', 'at', 'daci', 'cr'];
create_opt_attr_list['hd_dooLk'] = ['rn', 'acpi', 'et', 'lbl', 'aa', 'at', 'daci', 'cr'];
create_opt_attr_list['hd_bat'] = ['rn', 'acpi', 'et', 'lbl', 'aa', 'at', 'daci', 'cr'];
create_opt_attr_list['hd_tempe'] = ['rn', 'acpi', 'et', 'lbl', 'aa', 'at', 'daci', 'cr'];
create_opt_attr_list['hd_binSh'] = ['rn', 'acpi', 'et', 'lbl', 'aa', 'at', 'daci', 'cr'];
create_opt_attr_list['hd_fauDn'] = ['rn', 'acpi', 'et', 'lbl', 'aa', 'at', 'daci', 'cr'];
create_opt_attr_list['hd_colSn'] = ['rn', 'acpi', 'et', 'lbl', 'aa', 'at', 'daci', 'cr'];
create_opt_attr_list['hd_color'] = ['rn', 'acpi', 'et', 'lbl', 'aa', 'at', 'daci', 'cr'];
create_opt_attr_list['hd_brigs'] = ['rn', 'acpi', 'et', 'lbl', 'aa', 'at', 'daci', 'cr'];

global.update_np_attr_list = {};
update_np_attr_list.acp = ['rn', 'ty', 'ri', 'pi', 'ct', 'lt'];
update_np_attr_list.csr = ['rn', 'ty', 'ri', 'pi', 'ct', 'lt', 'st', 'cst', 'cb', 'csi'];
update_np_attr_list.ae = ['rn', 'ty', 'ri', 'pi', 'ct', 'lt', 'st', 'api', 'aei'];
update_np_attr_list.cnt = ['rn', 'ty', 'ri', 'pi', 'ct', 'lt', 'st', 'cr', 'cni', 'cbs', 'disr'];
update_np_attr_list.sub = ['rn', 'ty', 'ri', 'pi', 'ct', 'lt', 'st', 'cr', 'psn', 'su'];
update_np_attr_list.lcp = ['rn', 'ty', 'ri', 'pi', 'ct', 'lt', 'st', 'los', 'lot', 'lor', 'loi', 'lon', 'lost'];
update_np_attr_list.grp = ['rn', 'ty', 'ri', 'pi', 'ct', 'lt', 'st', 'cr', 'mt', 'cnm', 'mtv', 'csy', 'ssi'];
update_np_attr_list.nod = ['rn', 'ty', 'ri', 'pi', 'ct', 'lt', 'st', 'hcl'];
update_np_attr_list.smd = ['rn', 'ty', 'ri', 'pi', 'ct', 'lt', 'st', 'cr'];
update_np_attr_list.mms =['rn', 'ty', 'ri', 'pi', 'ct', 'lt', 'st', 'sid', 'soid'];

update_np_attr_list.fwr = ['rn', 'ty', 'ri', 'pi', 'ct', 'lt', 'st', 'mgd', 'objs', 'obps'];
update_np_attr_list.bat = ['rn', 'ty', 'ri', 'pi', 'ct', 'lt', 'st', 'mgd', 'objs', 'obps'];
update_np_attr_list.dvi = ['rn', 'ty', 'ri', 'pi', 'ct', 'lt', 'st', 'mgd', 'objs', 'obps'];
update_np_attr_list.dvc = ['rn', 'ty', 'ri', 'pi', 'ct', 'lt', 'st', 'mgd', 'objs', 'obps'];
update_np_attr_list.rbo = ['rn', 'ty', 'ri', 'pi', 'ct', 'lt', 'st', 'mgd', 'objs', 'obps'];

update_np_attr_list.fcnt = ['rn', 'ty', 'ri', 'pi', 'ct', 'lt', 'st', 'cnd'];
update_np_attr_list['hd_dooLk'] = ['rn', 'ty', 'ri', 'pi', 'ct', 'lt', 'st', 'cnd'];
update_np_attr_list['hd_bat'] = ['rn', 'ty', 'ri', 'pi', 'ct', 'lt', 'st', 'cnd'];
update_np_attr_list['hd_tempe'] = ['rn', 'ty', 'ri', 'pi', 'ct', 'lt', 'st', 'cnd'];
update_np_attr_list['hd_binSh'] = ['rn', 'ty', 'ri', 'pi', 'ct', 'lt', 'st', 'cnd'];
update_np_attr_list['hd_fauDn'] = ['rn', 'ty', 'ri', 'pi', 'ct', 'lt', 'st', 'cnd'];
update_np_attr_list['hd_colSn'] = ['rn', 'ty', 'ri', 'pi', 'ct', 'lt', 'st', 'cnd'];
update_np_attr_list['hd_color'] = ['rn', 'ty', 'ri', 'pi', 'ct', 'lt', 'st', 'cnd'];
update_np_attr_list['hd_brigs'] = ['rn', 'ty', 'ri', 'pi', 'ct', 'lt', 'st', 'cnd'];

global.update_m_attr_list = {};
update_m_attr_list.acp = [];
update_m_attr_list.csr = [];
update_m_attr_list.ae = [];
update_m_attr_list.cnt = [];
update_m_attr_list.sub = [];
update_m_attr_list.lcp = [];
update_m_attr_list.grp = [];
update_m_attr_list.nod = [];
update_m_attr_list.smd = [];
update_m_attr_list.mms = [];

update_m_attr_list.fwr = [];
update_m_attr_list.bat = [];
update_m_attr_list.dvi = [];
update_m_attr_list.dvc = [];
update_m_attr_list.rbo = [];

update_m_attr_list.fcnt = [];
update_m_attr_list['hd_dooLk'] = [];
update_m_attr_list['hd_bat'] = [];
update_m_attr_list['hd_tempe'] = [];
update_m_attr_list['hd_binSh'] = [];
update_m_attr_list['hd_fauDn'] = [];
update_m_attr_list['hd_colSn'] = [];
update_m_attr_list['hd_color'] = [];
update_m_attr_list['hd_brigs'] = [];

global.update_opt_attr_list = {};
update_opt_attr_list.acp = ['et', 'lbl', 'aa', 'at', 'pv', 'pvs'];
update_opt_attr_list.csr = ['acpi', 'et', 'lbl', 'aa', 'at', 'daci', 'poa', 'mei', 'rr', 'nl', 'tri', 'esi', 'srv'];
update_opt_attr_list.ae = ['acpi', 'et', 'lbl', 'aa', 'at', 'daci', 'apn', 'poa', 'or', 'nl', 'rr', 'csz', 'esi', 'srv'];
update_opt_attr_list.cnt = ['acpi', 'et', 'lbl', 'aa', 'at', 'daci', 'mni', 'mbs', 'mia', 'li', 'or'];
update_opt_attr_list.sub = ['acpi', 'et', 'lbl', 'daci', 'enc', 'exc', 'nu', 'gpi', 'bn', 'rl', 'pn', 'nsp', 'ln', 'nct', 'nec'];
update_opt_attr_list.lcp = ['acpi', 'et', 'lbl', 'aa', 'at', 'daci', 'lou'];
update_opt_attr_list.grp = ['acpi', 'et', 'lbl', 'aa', 'at', 'daci', 'mnm', 'mid', 'macp', 'gn'];
update_opt_attr_list.nod = ['acpi', 'et', 'lbl', 'aa', 'at', 'daci', 'ni', 'mgca'];
update_opt_attr_list.smd = ['acpi', 'et', 'lbl', 'aa', 'at', 'dcrp', 'soe', 'dsp', 'or', 'rels'];
update_opt_attr_list.mms =['acpi', 'et', 'lbl', 'aa', 'at', 'stid', 'asd', 'osd', 'sst'];
// cr 이 옵션 목록에 있었다. update_body 는 본문 속성을 전부 그대로 옮기므로
// PUT {"m2m:tr":{"cr":"남"}} 하나로 소유권이 넘어갔다 — creator_bypasses 가
// 들어온 뒤로는 그것이 곧 권한 탈취다. 다른 타입은 전부 np 목록에 있다.

update_opt_attr_list.fwr = ['acpi', 'et', 'lbl', 'daci', 'dc', 'cmlk', 'vr', 'fwnnam', 'url', 'ud', 'uds'];
update_opt_attr_list.bat = ['acpi', 'et', 'lbl', 'daci', 'dc', 'cmlk', 'btl', 'bts'];
update_opt_attr_list.dvi = ['acpi', 'et', 'lbl', 'daci', 'dc', 'cmlk', 'dlb', 'man', 'mod', 'dty', 'fwv', 'swv', 'hwv'];
update_opt_attr_list.dvc = ['acpi', 'et', 'lbl', 'daci', 'dc', 'cmlk', 'can', 'att', 'cas', 'cus', 'ena', 'dis'];
update_opt_attr_list.rbo = ['acpi', 'et', 'lbl', 'daci', 'dc', 'cmlk', 'rbo', 'far'];

update_opt_attr_list.fcnt = ['acpi', 'et', 'lbl'];
update_opt_attr_list['hd_dooLk'] = ['acpi', 'et', 'lbl', 'lock'];
update_opt_attr_list['hd_bat'] = ['acpi', 'et', 'lbl', 'lvl'];
update_opt_attr_list['hd_tempe'] = ['acpi', 'et', 'lbl', 'curT0'];
update_opt_attr_list['hd_binSh'] = ['acpi', 'et', 'lbl', 'powerSe'];
update_opt_attr_list['hd_fauDn'] = ['acpi', 'et', 'lbl', 'sus'];
update_opt_attr_list['hd_colSn'] = ['acpi', 'et', 'lbl', 'colSn'];
update_opt_attr_list['hd_color'] = ['acpi', 'et', 'lbl', 'red', 'green', 'blue'];
update_opt_attr_list['hd_brigs'] = ['acpi', 'et', 'lbl', 'brigs'];
// ── 여기까지 ─────────────────────────────────────────────────────────

exports.create_m_attr_list = global.create_m_attr_list;
exports.create_opt_attr_list = global.create_opt_attr_list;
exports.update_np_attr_list = global.update_np_attr_list;
exports.update_m_attr_list = global.update_m_attr_list;
exports.update_opt_attr_list = global.update_opt_attr_list;
