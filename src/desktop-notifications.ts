const key=(userId:string)=>`yht-desktop-notifications:${userId}`
export function desktopEnabled(userId:string){return localStorage.getItem(key(userId))!=='off'}
export function setDesktopEnabled(userId:string,enabled:boolean){localStorage.setItem(key(userId),enabled?'on':'off')}
export function desktopAllowed(userId:string){return desktopEnabled(userId)&&'Notification'in window&&Notification.permission==='granted'}

/** Persist a bounded set per account so multiple tabs do not repeat the same desktop alert. */
export async function showDesktop(userId:string,id:string,title:string,options:NotificationOptions,onClick:()=>void){
  if(!desktopAllowed(userId))return
  function show(){
    const storageKey=`yht-desktop-receipts:${userId}`
    let seen:string[]=[]
    try{seen=JSON.parse(localStorage.getItem(storageKey)||'[]')}catch{/* An old invalid preference must not break notifications. */}
    if(!Array.isArray(seen))seen=[]
    if(seen.includes(id))return
    try{
      const notice=new Notification(title,{...options,tag:`yht-${id}`,icon:'/favicon.svg'})
      notice.onclick=()=>{notice.close();window.focus();onClick()}
      localStorage.setItem(storageKey,JSON.stringify([...seen.slice(-99),id]))
    }catch{/* Permission may have changed after checking. The inbox still records the notification. */}
  }
  if(navigator.locks)await navigator.locks.request(`yht-notice:${userId}`,show)
  else show()
}
