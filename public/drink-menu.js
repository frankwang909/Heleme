// Keep drink IDs as the source of identity; identical names can belong to different brands.
export function groupDrinksByBrand(drinks){
 const groups=new Map();
 for(const drink of drinks){
  if(!groups.has(drink.brand_name))groups.set(drink.brand_name,[]);
  groups.get(drink.brand_name).push(drink);
 }
 return new Map([...groups].sort(([a],[b])=>a.localeCompare(b,'zh')).map(([brand,items])=>[
  brand,[...items].sort((a,b)=>a.name.localeCompare(b.name,'zh')||a.id.localeCompare(b.id))
 ]));
}

export function findDrinkSelection(menu,drinkId){
 for(const [brand,drinks] of menu){
  if(drinks.some(drink=>drink.id===drinkId))return {brand,drinkId};
 }
 return {brand:'',drinkId:''};
}

// Browsing the menu does not require a verified price or a recommendation result.
export function browseDrinks(drinks,{brand='',category='',query=''}={}){
 const text=query.trim().toLocaleLowerCase('zh-CN');
 return drinks.filter(d=>d.status!=='inactive'&&(!brand||d.brand_name===brand)&&(!category||d.category===category)&&(!text||(d.brand_name+' '+d.name).toLocaleLowerCase('zh-CN').includes(text)));
}
