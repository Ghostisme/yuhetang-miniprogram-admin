export type Permission = {code:string;requires?:string[];headquartersOnly?:boolean}

export function moduleAllowed(id:string,permission:string,can:(code:string)=>boolean,hq=true){
  if((id==='integrations'||id==='wechat-menu')&&!hq)return false
  if(id==='content')return can('content:read')||can('services:read')
  if(id==='stores')return can('stores:write')||can('rules:write')
  return can(permission)
}

// Selecting an action includes the permissions needed to reach it. Removing a
// prerequisite also removes its dependent actions so the saved role is explicit.
export function togglePermission(current:string[],code:string,enabled:boolean,catalog:Permission[]){
  const next=new Set(current)
  if(enabled){
    const add=(key:string)=>{if(next.has(key))return;next.add(key);for(const dependency of catalog.find(p=>p.code===key)?.requires||[])add(dependency)}
    add(code)
  }else{
    next.delete(code)
    let changed=true
    while(changed){changed=false;for(const p of catalog)if(next.has(p.code)&&(p.requires||[]).some(key=>!next.has(key))){next.delete(p.code);changed=true}}
  }
  return [...next]
}
