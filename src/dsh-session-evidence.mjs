// Only the owned DSH adapter carries these capabilities across the dispatcher
// boundary. Wire payloads and serialised result fields cannot register a turn.
const sessions=new WeakMap();

export const dshBotNameForAction=action=>action.payload?.profile||action.payload?.runtimeProfile||action.payload?.runtime_profile||action.payload?.dshBotName||action.payload?.botName||null;

export function createDshSessionEvidence(scope,stop) {
  const identity=Object.freeze({...scope});
  const capability=Object.freeze({});let turn=null,terminal=null,resolve;
  const completionEvidence=new Promise(done=>{resolve=done;});
  sessions.set(capability,Object.freeze({scope:identity,stop,completionEvidence}));
  return {
    capability,
    acceptRequest(value){if(turn===null&&Number.isSafeInteger(value)&&value>=0)turn=value;},
    finishTurn(value,reason){
      if(terminal||turn===null||value!==turn||typeof reason!=='string'||!reason)return null;
      terminal=Object.freeze({schemaVersion:1,source:'dsh-native-session',...identity,turn,reason,terminalConfirmed:true});
      resolve(terminal);return terminal;
    }
  };
}

export function dshSessionSupervision(capability,expected) {
  const entry=sessions.get(capability);
  if(!entry||Object.entries(expected).some(([key,value])=>entry.scope[key]!==value))return null;
  return entry;
}
