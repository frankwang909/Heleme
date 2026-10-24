import {test} from 'node:test';
import assert from 'node:assert/strict';
import {groupDrinksByBrand,findDrinkSelection,browseDrinks} from '../public/drink-menu.js';

const drinks=[
 {id:'a',brand_name:'品牌甲',name:'拿铁'},
 {id:'b',brand_name:'品牌乙',name:'拿铁'},
 {id:'c',brand_name:'品牌甲',name:'美式'}
];
test('brand menus keep same-named drinks separate without changing their IDs',()=>{
 const menu=groupDrinksByBrand(drinks);
 assert.equal(menu.size,2);
 assert.deepEqual(new Set(menu.get('品牌甲').map(d=>d.id)),new Set(['a','c']));
 assert.deepEqual(menu.get('品牌乙').map(d=>d.id),['b']);
 assert.equal(drinks[0].id,'a');
});
test('record shortcuts resolve their exact brand and drink, while new or missing choices stay empty',()=>{
 const menu=groupDrinksByBrand(drinks);
 assert.deepEqual(findDrinkSelection(menu,'b'),{brand:'品牌乙',drinkId:'b'});
 assert.deepEqual(findDrinkSelection(menu,undefined),{brand:'',drinkId:''});
 assert.deepEqual(findDrinkSelection(menu,'removed'),{brand:'',drinkId:''});
 assert.deepEqual(findDrinkSelection(groupDrinksByBrand([]),'a'),{brand:'',drinkId:''});
});

test('menu browsing keeps unknown prices visible regardless of recommendation price switches',()=>{
 const menu=[{id:'a',brand_name:'品牌甲',name:'茉莉奶白',category:'鲜奶茶',price:null,reference_price:16},
  {id:'b',brand_name:'品牌乙',name:'桂花奶白',category:'鲜奶茶',price:null},
  {id:'c',brand_name:'品牌乙',name:'旧款',category:'纯茶',price:8,status:'inactive'}];
 assert.equal(browseDrinks(menu,{budget:0,includeUnknown:false}).length,2);
 assert.deepEqual(browseDrinks(menu,{brand:'品牌甲',category:'鲜奶茶',query:' 茉莉 '}).map(d=>d.id),['a']);
 assert.equal(browseDrinks(menu,{query:'不存在'}).length,0);
});
