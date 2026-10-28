import test from 'node:test';
import assert from 'node:assert/strict';
import { bookProgress } from '../next/progress.mjs';
import { makeCatalog, openStore } from '../next/core.mjs';
const catalog=makeCatalog([{w:'test',m:'試験',s:'teppan',p:'名詞'},{w:'test',m:'試験2',s:'teppan',p:'名詞'},{w:'other',m:'他',s:'teppan',p:'名詞'}],[{id:1,b:'kin'},{id:2,b:'kin'}]);
test('book progress intersects current content and unions word modes without duplicating words',()=>{
 const records=openStore({getItem:()=>null}).data.records;
 records.seenWords.e2j=['test','gone'];records.seenWords.type=['test'];records.grammarSeen=[1,999];
 assert.deepEqual(bookProgress(catalog,records,'vocab','teppan'),{total:2,seen:1,unseen:1});
 assert.deepEqual(bookProgress(catalog,records,'grammar','kin'),{total:2,seen:1,unseen:1});
 assert.deepEqual(bookProgress(catalog,records,'grammar','missing'),{total:0,seen:0,unseen:0});
});
import { reviewSummary } from '../next/progress.mjs';
test('review summary counts existing weaknesses and only real graduations',()=>{
 assert.deepEqual(reviewSummary({answers:{a:{correct:true,wasWeak:true,graduated:false},b:{correct:false,wasWeak:true},c:{correct:true}}}),{reviewed:1,graduated:0});
 assert.deepEqual(reviewSummary({answers:{a:{correct:true,wasWeak:true,graduated:true}}}),{reviewed:1,graduated:1});
});
