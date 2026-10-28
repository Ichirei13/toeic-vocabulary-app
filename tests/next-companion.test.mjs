import test from 'node:test';
import assert from 'node:assert/strict';
import { companionVisible, feedbackModel, companionMarkup } from '../next/companion.mjs';
test('companion settings preserve theme defaults and explicit choices',()=>{
 assert.equal(companionVisible({companion:'auto'},'duolingo'),true);
 assert.equal(companionVisible({companion:'auto'},'light'),false);
 assert.equal(companionVisible({companion:'off'},'duolingo'),false);
 assert.equal(companionVisible({companion:'on'},'light'),true);
 assert.match(companionMarkup('celebrate'),/aria-hidden="true"/);
 assert.ok(!companionMarkup('<script>').includes('<script>'));
});
test('feedback chooses one supplementary achievement and keeps wrong answer primary',()=>{
 const f=feedbackModel({correct:true,goalReached:true,streak:5,reviewed:0,complete:false});
 assert.match(f.detail,/目標達成/);assert.ok(!f.detail.includes('連続'));
 assert.match(feedbackModel({correct:false,goalReached:true,streak:0}).message,/覚え/);
 assert.match(feedbackModel({correct:true,goalReached:false,streak:3}).message,/3問連続/);
});
