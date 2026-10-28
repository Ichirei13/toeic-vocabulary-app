import test from 'node:test';
import assert from 'node:assert/strict';
import { defaultPreferences, validatePreferences } from '../next/preferences.mjs';
test('preferences default independently and reject unsafe settings', () => {
 const p=defaultPreferences(); p.presets.x={}; assert.deepEqual(defaultPreferences().presets,{});
 assert.equal(validatePreferences(defaultPreferences()).dailyGoal,10);
 for(const raw of [{...defaultPreferences(),dailyGoal:11},{...defaultPreferences(),companion:'evil'},JSON.parse('{"dailyGoal":10,"companion":"auto","recentPreset":null,"presets":{"__proto__":{}}}')]) assert.throws(()=>validatePreferences(raw));
});
