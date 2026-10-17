/** Observe only visible message rows. Creating this observer never marks a conversation read. */
export function createMessageReadObserver(root,onVisible,{document=globalThis.document,IntersectionObserver=globalThis.IntersectionObserver}={}){
  const noop=()=>{};noop.update=noop;
  if(!root?.querySelectorAll||typeof onVisible!=='function'||typeof IntersectionObserver!=='function'||!document?.addEventListener)return noop;
  let active=true,lastId='',notification=0,observer;
  const observed=new Set(),intersecting=new Set();
  const rows=()=>Array.from(root.querySelectorAll('[data-message-id]'));
  const hasArea=rect=>rect&&[rect.left,rect.right,rect.top,rect.bottom].every(Number.isFinite)&&rect.right>rect.left&&rect.bottom>rect.top;
  function inView(element){
    if(root.isConnected===false||element.isConnected===false||root.contains?.(element)===false)return false;
    const box=element.getBoundingClientRect?.(),bounds=root.getBoundingClientRect?.();
    if(!hasArea(box)||!hasArea(bounds))return false;
    const width=document.defaultView?.innerWidth||document.documentElement?.clientWidth;
    const height=document.defaultView?.innerHeight||document.documentElement?.clientHeight;
    if(!Number.isFinite(width)||!Number.isFinite(height)||width<=0||height<=0)return false;
    return Math.min(box.right,bounds.right,width)>Math.max(box.left,bounds.left,0)&&Math.min(box.bottom,bounds.bottom,height)>Math.max(box.top,bounds.top,0);
  }
  function notify(){
    if(!active||document.visibilityState!=='visible')return;
    let latest='';
    for(const row of rows())if(observed.has(row)&&intersecting.has(row)&&inView(row)){
      const id=row.getAttribute('data-message-id');if(id)latest=id;
    }
    if(latest&&latest!==lastId){
      lastId=latest;const attempt=++notification;
      const failed=()=>{if(active&&notification===attempt&&lastId===latest)lastId='';};
      try{Promise.resolve(onVisible(latest)).then(confirmed=>{if(confirmed===false)failed();},failed);}catch{failed();}
    }
  }
  function foreground(){if(active&&document.visibilityState==='visible'){lastId='';notify();}}
  try{
    observer=new IntersectionObserver(entries=>{
      if(!active)return;
      for(const entry of entries){
        if(!observed.has(entry.target))continue;
        if(entry.isIntersecting&&entry.intersectionRatio>0&&entry.isVisible!==false)intersecting.add(entry.target);
        else intersecting.delete(entry.target);
      }
      notify();
    },{root,threshold:0});
  }catch{return noop;}
  function update(){
    if(!active)return;
    const current=new Set(rows());
    for(const row of observed)if(!current.has(row)){observer.unobserve(row);observed.delete(row);intersecting.delete(row);}
    for(const row of current)if(!observed.has(row)){observed.add(row);observer.observe(row);}
  }
  function cleanup(){
    if(!active)return;active=false;observer.disconnect();observed.clear();intersecting.clear();document.removeEventListener('visibilitychange',foreground);
  }
  cleanup.update=update;
  document.addEventListener('visibilitychange',foreground);update();
  return cleanup;
}
