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

import { addDailyAnswer, setDailyGoal, activitySummary, monthModel } from '../next/activity.mjs';
test('daily count crosses midnight, goal changes only today, and streak survives an unstudied today',()=>{
 let a=emptyActivity(new Date(2026,9,27));
 a=addDailyAnswer(a,5,new Date(2026,9,27,23,59));
 a=addDailyAnswer(a,10,new Date(2026,9,28,0,1));
 assert.equal(activitySummary(a,10,new Date(2026,9,28)).answers,1);
 assert.equal(activitySummary(a,10,new Date(2026,9,29)).streak,2);
 assert.equal(activitySummary(a,10,new Date(2026,9,30)).streak,0);
 const data={preferences:{dailyGoal:10},activity:a};
 const updated=setDailyGoal(data,5,new Date(2026,9,28));assert.equal(updated.activity.days['2026-10-27'].goal,5);assert.equal(updated.activity.days['2026-10-28'].goal,5);
 assert.equal(setDailyGoal(updated,0,new Date(2026,9,28)).preferences.dailyGoal,0);
 assert.equal(activitySummary(a,0,new Date(2026,9,28)).achieved,false);
});
test('calendar has leap day, real month bounds, and no future navigation',()=>{
 const a=emptyActivity(new Date(2024,1,29));
 const model=monthModel(a,'2024-02',new Date(2024,1,29));
 assert.equal(model.days.filter(Boolean).length,29);assert.equal(model.canGoNext,false);
 assert.equal(monthModel(a,'2024-01',new Date(2024,1,29)).canGoNext,true);
 assert.throws(()=>monthModel(a,'2024-13',new Date(2024,1,29)));
});
