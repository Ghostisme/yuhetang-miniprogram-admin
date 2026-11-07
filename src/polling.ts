/** One request at a time; inactive tabs stop polling and resume with jitter. */
export function startPolling(task:()=>void|Promise<unknown>,interval:number){
  let stopped=false,running=false,failures=0,timer:ReturnType<typeof setTimeout>
  function schedule(delay:number){clearTimeout(timer);if(!stopped)timer=setTimeout(tick,delay*(0.9+Math.random()*0.2))}
  async function tick(){
    if(stopped||running)return
    if(document.hidden){schedule(interval);return}
    running=true
    try{await task();failures=0}catch{failures=Math.min(4,failures+1)}
    finally{running=false;schedule(Math.min(120000,interval*2**failures))}
  }
  function visible(){if(!document.hidden&&!running)schedule(300+Math.random()*1700)}
  document.addEventListener('visibilitychange',visible)
  void tick()
  return()=>{stopped=true;clearTimeout(timer);document.removeEventListener('visibilitychange',visible)}
}
