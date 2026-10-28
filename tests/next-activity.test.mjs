import test from 'node:test';
import assert from 'node:assert/strict';
import { localDateKey, emptyActivity, validateActivity, mergeActivity } from '../next/activity.mjs';
test('activity preserves real local dates and validates day counts',()=>{
 assert.equal(localDateKey(new Date(2026,9,28,23,59)),'2026-10-28');
 assert.deepEqual(emptyActivity(new Date(2026,9,28)).days,{});
 for(const date of ['2026-02-30','bad','2025-02-29']) assert.throws(()=>validateActivity({startedOn:'2026-10-28',days:{[date]:{answers:1,goal:10}}}));
 assert.throws(()=>validateActivity({startedOn:'2026-10-28',days:{'2026-10-28':{answers:-1,goal:10}}}));
});
test('activity merge is idempotent and keeps current day goal',()=>{
 const a={startedOn:'2026-10-27',days:{'2026-10-28':{answers:4,goal:10}}};
 const b={startedOn:'2026-10-28',days:{'2026-10-28':{answers:6,goal:5}}};
 const once=mergeActivity(a,b);assert.deepEqual(once.days['2026-10-28'],{answers:6,goal:10});assert.deepEqual(mergeActivity(once,b),once);assert.equal(a.days['2026-10-28'].answers,4);
});
