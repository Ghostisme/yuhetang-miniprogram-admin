const key=(userId:string)=>`yht-desktop-notifications:${userId}`
export function desktopEnabled(userId:string){return localStorage.getItem(key(userId))!=='off'}
export function setDesktopEnabled(userId:string,enabled:boolean){localStorage.setItem(key(userId),enabled?'on':'off')}
export function desktopAllowed(userId:string){return desktopEnabled(userId)&&'Notification'in window&&Notification.permission==='granted'}
