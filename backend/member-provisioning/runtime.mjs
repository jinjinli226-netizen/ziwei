import { createNativeEnrollment } from './service.mjs';
import { createProvisionerVerifier } from './auth.mjs';
import { createMemberProvisioningHandler } from './http.mjs';
/** The only resource selector is deployment-controlled environment/config. */
export function createNativeProvisioningRuntime({site,db,identityDb,identityConfig,env=process.env,fetch}={}){
 const prefix=`ZIWEI_${String(site).toUpperCase()}`;
 const config={enabled:env[`${prefix}_MEMBER_PROVISIONING`]==='enabled',site,issuer:identityConfig?.issuer,apiClientSecret:identityConfig?.apiClientSecret??identityConfig?.apiSecret,callerClientId:env[`${prefix}_PROVISIONER_CLIENT_ID`],callerSubject:env[`${prefix}_PROVISIONER_SUBJECT`],workspaceId:env[`${prefix}_MEMBER_WORKSPACE_ID`],fetch};
 const verifier=createProvisionerVerifier(config);let service=createNativeEnrollment({config:{enabled:false}}),configurationError=null;
 if(config.enabled&&verifier.configured){try{service=createNativeEnrollment({db,identityDb,config});}catch{configurationError='NATIVE_PROVISIONING_CONFIGURATION';}}
 return Object.freeze({configured:service.configured,configurationError,supportsEnsure:false,roles:service.roles,handler:createMemberProvisioningHandler({service,verifier})});
}
