package com.ziwei.manager;

import android.content.Context;
import android.security.keystore.KeyGenParameterSpec;
import android.security.keystore.KeyProperties;
import android.util.AtomicFile;
import java.io.File;
import java.io.FileOutputStream;
import java.nio.charset.StandardCharsets;
import java.security.KeyStore;
import java.util.Arrays;
import javax.crypto.Cipher;
import javax.crypto.KeyGenerator;
import javax.crypto.SecretKey;
import javax.crypto.spec.GCMParameterSpec;

/** One atomic, authenticated encrypted record in noBackupFilesDir; no tokens in preferences. */
final class IdentityStore {
    private static final String ALIAS = "ziwei.manager.oidc.refresh.v1";
    private final AtomicFile file;
    IdentityStore(Context context) { file = new AtomicFile(new File(context.getNoBackupFilesDir(), "identity-session-v1.enc")); }
    private SecretKey key() throws Exception {
        KeyStore store=KeyStore.getInstance("AndroidKeyStore");store.load(null);
        if(store.containsAlias(ALIAS))return (SecretKey)store.getKey(ALIAS,null);
        KeyGenerator generator=KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES,"AndroidKeyStore");
        generator.init(new KeyGenParameterSpec.Builder(ALIAS,KeyProperties.PURPOSE_ENCRYPT|KeyProperties.PURPOSE_DECRYPT)
                .setBlockModes(KeyProperties.BLOCK_MODE_GCM).setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE)
                .setRandomizedEncryptionRequired(true).build());
        return generator.generateKey();
    }
    String read() throws Exception {
        byte[] data;
        try(java.io.InputStream input=file.openRead()){
            java.io.ByteArrayOutputStream bytes=new java.io.ByteArrayOutputStream();byte[] buffer=new byte[4096];int count;
            while((count=input.read(buffer))!=-1){if(bytes.size()+count>131072)throw OidcRules.invalid();bytes.write(buffer,0,count);}data=bytes.toByteArray();
        }catch(java.io.FileNotFoundException absent){return null;}
        if(data.length<30||data[0]!=1)throw OidcRules.invalid();
        Cipher cipher=Cipher.getInstance("AES/GCM/NoPadding");cipher.init(Cipher.DECRYPT_MODE,key(),new GCMParameterSpec(128,Arrays.copyOfRange(data,1,13)));
        cipher.updateAAD(ALIAS.getBytes(StandardCharsets.US_ASCII));
        return new String(cipher.doFinal(data,13,data.length-13),StandardCharsets.UTF_8);
    }
    void write(String record) throws Exception {
        Cipher cipher=Cipher.getInstance("AES/GCM/NoPadding");cipher.init(Cipher.ENCRYPT_MODE,key());cipher.updateAAD(ALIAS.getBytes(StandardCharsets.US_ASCII));
        byte[] encrypted=cipher.doFinal(record.getBytes(StandardCharsets.UTF_8));
        FileOutputStream output=null;
        try{output=file.startWrite();output.write(1);output.write(cipher.getIV());output.write(encrypted);file.finishWrite(output);}
        catch(Exception failure){if(output!=null)file.failWrite(output);throw failure;}
    }
    void clear() { file.delete(); }
}
