import test from 'node:test';
import assert from 'node:assert/strict';
import { defaultPreferences, validatePreferences } from '../next/preferences.mjs';
test('preferences default independently and reject unsafe settings', () => {
 const p=defaultPreferences(); p.presets.x={}; assert.deepEqual(defaultPreferences().presets,{});
 assert.equal(validatePreferences(defaultPreferences()).dailyGoal,10);
 for(const raw of [{...defaultPreferences(),dailyGoal:11},{...defaultPreferences(),companion:'evil'},JSON.parse('{"dailyGoal":10,"companion":"auto","recentPreset":null,"presets":{"__proto__":{}}}')]) assert.throws(()=>validatePreferences(raw));
});

import { rememberPreset, resolvePreset, presetKey } from '../next/preferences.mjs';
const config={kind:'grammar',source:'kin',mode:'e2j',filter:'all',count:'20',chapters:[2],pos:[],ranges:[],dates:[]};
test('presets are copied and stale chapter choices require explicit confirmation',()=>{
 const p=rememberPreset(defaultPreferences(),config);config.chapters.push(3);
 assert.equal(p.recentPreset,'grammar:kin');assert.deepEqual(p.presets[presetKey(config)].chapters,[2]);
 const catalog={items:[{kind:'grammar',source:'kin',ch:1}]};
 const result=resolvePreset(p,'grammar:kin',catalog);assert.equal(result.needsConfirmation,true);assert.deepEqual(result.config.chapters,[]);
 assert.equal(resolvePreset(p,'grammar:kin',{items:[]}).config,null);
});
