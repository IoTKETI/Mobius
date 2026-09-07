/** @file Resource default constants. Pure module without dependencies. */

'use strict';

// Expiration time (UTC) for resources created without et. Effectively never expires; clients that want expiry set et explicitly. oneM2M et is 'YYYYMMDDTHHmmss' and compares as a string.
exports.DEFAULT_ET = '20991231T235959';
