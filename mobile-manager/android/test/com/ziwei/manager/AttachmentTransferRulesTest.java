package com.ziwei.manager;

import java.io.ByteArrayInputStream;
import java.io.ByteArrayOutputStream;
import java.io.File;
import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.nio.file.Files;
import java.util.Arrays;
import java.util.Base64;

/** Runs real decode/stream/logging implementation without an Android service or network. */
public final class AttachmentTransferRulesTest {
    private static int checks;
    interface Checked { void run() throws Exception; }
    static void yes(boolean value){checks++;if(!value)throw new AssertionError("Expected true");}
    static void reject(Checked run)throws Exception{checks++;try{run.run();}catch(IllegalArgumentException|IOException expected){return;}throw new AssertionError("Expected rejection");}
    static final class Generated extends InputStream {
        long remaining;
        Generated(long size){remaining=size;}
        @Override public int read(){if(remaining==0)return -1;remaining--;return 7;}
        @Override public int read(byte[] buffer,int offset,int length){if(remaining==0)return -1;int count=(int)Math.min(remaining,length);Arrays.fill(buffer,offset,offset+count,(byte)7);remaining-=count;return count;}
    }
    static final class Counting extends OutputStream {
        long bytes;int largest;
        @Override public void write(int value){bytes++;}
        @Override public void write(byte[] buffer,int offset,int count){bytes+=count;largest=Math.max(largest,count);}
    }
    public static void main(String[] args)throws Exception{
        yes(!AttachmentTransferRules.imagesOnly(null));yes(!AttachmentTransferRules.imagesOnly(new String[]{}));
        yes(!AttachmentTransferRules.imagesOnly(new String[]{""}));yes(!AttachmentTransferRules.imagesOnly(new String[]{"application/pdf"}));
        yes(!AttachmentTransferRules.imagesOnly(new String[]{"image/png","application/zip"}));
        yes(AttachmentTransferRules.imagesOnly(new String[]{"image/png","image/jpeg"}));
        String chunk="/api/conversations/conv_1/attachments/uploads/upload_1?offset=0",download="/api/conversations/conv_1/attachments/att_1";
        AttachmentTransferRules.uploadPath(chunk);AttachmentTransferRules.uploadPath(chunk.replace("offset=0","offset=524288000"));checks+=2;
        for(String path:new String[]{"https://ziwei.qzelynth.top"+chunk,chunk+"&token=x",chunk.replace("offset=0","offset=-1"),chunk.replace("offset=0","offset=01"),chunk.replace("offset=0","offset=524288001"),chunk.replace("upload_1","../upload_1"),chunk.replace("upload_1","%2fupload_1"),download})reject(()->AttachmentTransferRules.uploadPath(path));
        AttachmentTransferRules.downloadPath(download);checks++;
        for(String path:new String[]{"https://ziwei.qzelynth.top"+download,download+"?token=forbidden",download+"#fragment",download.replace("att_1","uploads"),download.replace("att_1","../secret"),download.replace("att_1","%61tt_1"),chunk})reject(()->AttachmentTransferRules.downloadPath(path));
        yes(AttachmentTransferRules.idempotency("/api/conversations/conv_1/attachments/uploads","POST","stable-request:one"));
        yes(!AttachmentTransferRules.idempotency("/api/conversations/conv_1/messages","POST","stable-request"));
        yes(!AttachmentTransferRules.idempotency("/api/conversations/conv_1/attachments/uploads","PUT","stable-request"));
        yes(!AttachmentTransferRules.idempotency("/api/conversations/conv_1/attachments/uploads","POST","unsafe\r\nheader"));
        yes(!AttachmentTransferRules.idempotency("/api/conversations/conv_1/attachments/uploads","POST",new String(new char[129]).replace('\0','a')));
        byte[] original=new byte[AttachmentTransferRules.CHUNK_BYTES];Arrays.fill(original,(byte)31);
        yes(Arrays.equals(original,AttachmentTransferRules.decodeChunk(Base64.getEncoder().encodeToString(original))));
        reject(()->AttachmentTransferRules.decodeChunk(Base64.getEncoder().encodeToString(new byte[AttachmentTransferRules.CHUNK_BYTES+1])));
        for(String value:new String[]{"","Zm=8","Zm9v\n","Zg== ","Zh=="})reject(()->AttachmentTransferRules.decodeChunk(value));
        original=null;
        Counting sink=new Counting();long saved=AttachmentTransferRules.copy(new Generated(AttachmentTransferRules.FILE_BYTES),sink,AttachmentTransferRules.FILE_BYTES,()->{});
        yes(saved==AttachmentTransferRules.FILE_BYTES&&sink.bytes==saved&&sink.largest==65536);
        Counting oversize=new Counting();reject(()->AttachmentTransferRules.copy(new Generated(AttachmentTransferRules.FILE_BYTES+1),oversize,-1,()->{}));yes(oversize.bytes==AttachmentTransferRules.FILE_BYTES);
        reject(()->AttachmentTransferRules.copy(new Generated(0),new Counting(),AttachmentTransferRules.FILE_BYTES+1,()->{}));
        reject(()->AttachmentTransferRules.copy(new ByteArrayInputStream(new byte[3]),new Counting(),4,()->{}));
        IdentityFence fence=new IdentityFence();long before=fence.epoch();Counting cancelled=new Counting();
        InputStream switchAccount=new ByteArrayInputStream(new byte[10]){@Override public int read(byte[] bytes,int offset,int count){int n=super.read(bytes,offset,count);fence.invalidate();return n;}};
        reject(()->AttachmentTransferRules.copy(switchAccount,cancelled,10,()->{if(!fence.current(before))throw new IOException("Identity changed");}));yes(cancelled.bytes==0);
        reject(()->AttachmentTransferRules.filename("../file.txt"));reject(()->AttachmentTransferRules.filename("file\n.txt"));reject(()->AttachmentTransferRules.mimeType("text/plain\r\nX:bad"));
        yes(AttachmentTransferRules.filename("报告.pdf").equals("报告.pdf"));yes(AttachmentTransferRules.mimeType("application/pdf").equals("application/pdf"));
        File directory=new File(args[0]);AttachmentTransferLog.append(directory,"download_started",0);AttachmentTransferLog.append(directory,"download_saved",saved);
        String log=new String(Files.readAllBytes(new File(directory,"attachment-transfers.jsonl").toPath()),java.nio.charset.StandardCharsets.UTF_8);
        yes(log.contains("download_started")&&log.contains("524288000")&&!log.contains("报告.pdf")&&!log.contains(download));
        StringBuilder history=new StringBuilder();while(history.length()<=512*1024)history.append("{\"event\":\"previous_transfer\",\"bytes\":1}\n");
        Files.write(new File(directory,"attachment-transfers.jsonl").toPath(),history.toString().getBytes(java.nio.charset.StandardCharsets.UTF_8));
        AttachmentTransferLog.append(directory,"download_saved",1);
        yes(new File(directory,"attachment-transfers.previous.jsonl").length()==history.length());
        yes(new File(directory,"attachment-transfers.jsonl").length()<1024);
        System.out.println("Attachment transfer rules passed: "+checks+" checks; streamed "+saved+" bytes with "+sink.largest+" byte buffers");
    }
}
