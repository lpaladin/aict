package dev.aict.container;

import android.content.Context;
import android.database.Cursor;
import android.net.Uri;
import android.os.Environment;
import android.provider.DocumentsContract;
import android.util.Base64;
import org.json.*;
import java.io.*;
import java.nio.channels.FileChannel;
import java.nio.charset.StandardCharsets;

/** Chunked access to normal paths and Android content URIs. */
public final class FileAccess {
    public static String location(Context context, JSONObject p) throws Exception {
        if(p.has("uri")) return p.getString("uri");
        if(p.has("treeUri")) {
            Uri tree=Uri.parse(p.getString("treeUri"));
            Uri parent=DocumentsContract.buildDocumentUriUsingTree(tree,DocumentsContract.getTreeDocumentId(tree));
            Uri made=DocumentsContract.createDocument(context.getContentResolver(),parent,p.optString("mime","application/octet-stream"),p.getString("name"));
            if(made==null) throw new IOException("Document creation failed");
            return made.toString();
        }
        if(p.has("path")) return new File(p.getString("path")).getAbsolutePath();
        String name=p.optString("name","download-"+System.currentTimeMillis());
        return new File(context.getExternalFilesDir(Environment.DIRECTORY_DOWNLOADS),new File(name).getName()).getAbsolutePath();
    }
    public static JSONObject read(Context context, JSONObject p) throws Exception {
        String path=p.has("uri")?p.getString("uri"):p.getString("path");
        long offset=p.optLong("offset",0); int limit=p.optInt("length",131072);
        if(offset<0 || limit<1 || limit>1048576) throw new IllegalArgumentException("offset>=0; length must be 1..1048576");
        InputStream input=path.startsWith("content:") ? context.getContentResolver().openInputStream(Uri.parse(path)):new FileInputStream(path);
        if(input==null) throw new IOException("Cannot open file");
        try(InputStream in=input; ByteArrayOutputStream out=new ByteArrayOutputStream()) {
            long remaining=offset;
            while(remaining>0) { long skipped=in.skip(remaining); if(skipped==0){if(in.read()<0) break;skipped=1;} remaining-=skipped; }
            byte[] buffer=new byte[Math.min(limit,65536)]; int n; boolean eof=false;
            while(out.size()<limit) { n=in.read(buffer,0,Math.min(buffer.length,limit-out.size())); if(n<0){eof=true;break;} out.write(buffer,0,n); }
            byte[] data=out.toByteArray();
            JSONObject result=new JSONObject().put("location",path).put("offset",offset).put("nextOffset",offset+data.length).put("bytes",data.length).put("eof",eof).put("base64",Base64.encodeToString(data,Base64.NO_WRAP));
            if(p.optBoolean("text",false)) result.put("text",new String(data,StandardCharsets.UTF_8));
            return result;
        }
    }
    public static JSONObject write(Context context, JSONObject p) throws Exception {
        String path=location(context,p);
        byte[] data=p.has("base64")?Base64.decode(p.getString("base64"),Base64.DEFAULT):p.optString("text","").getBytes(StandardCharsets.UTF_8);
        if(data.length>1048576) throw new IllegalArgumentException("Use chunks <=1 MiB");
        long offset=p.optLong("offset",0); boolean append=p.optBoolean("append",false);
        if(offset<0) throw new IllegalArgumentException("negative offset");
        if(path.startsWith("content:")) {
            android.os.ParcelFileDescriptor fd=context.getContentResolver().openFileDescriptor(Uri.parse(path),append?"wa":offset==0?"rwt":"rw");
            if(fd==null) throw new IOException("Cannot open document");
            if(append)offset=Math.max(0,fd.getStatSize());
            try(FileOutputStream out=new android.os.ParcelFileDescriptor.AutoCloseOutputStream(fd)) {
                    if(!append && offset>0) out.getChannel().position(offset);
                    out.write(data); out.flush();
            }
        } else {
            File file=new File(path); File parent=file.getParentFile();
            if(parent!=null && !parent.isDirectory() && !parent.mkdirs()) throw new IOException("Cannot create directory");
            try(RandomAccessFile out=new RandomAccessFile(file,"rw")) {
                if(append) offset=out.length(); else if(offset==0) out.setLength(0);
                out.seek(offset); out.write(data);
            }
        }
        return new JSONObject().put("location",path).put("bytes",data.length).put("nextOffset",offset+data.length);
    }
    public static JSONArray list(Context context, JSONObject p) throws Exception {
        JSONArray out=new JSONArray();
        if(p.has("treeUri")) {
            Uri tree=Uri.parse(p.getString("treeUri"));
            String parent=p.optString("documentId",DocumentsContract.getTreeDocumentId(tree));
            Uri children=DocumentsContract.buildChildDocumentsUriUsingTree(tree,parent);
            String[] columns={"document_id","_display_name","mime_type","_size"};
            try(Cursor cursor=context.getContentResolver().query(children,columns,null,null,null)) {
                if(cursor!=null) while(cursor.moveToNext()) out.put(new JSONObject().put("documentId",cursor.getString(0)).put("name",cursor.getString(1)).put("mime",cursor.getString(2)).put("size",cursor.getLong(3)).put("uri",DocumentsContract.buildDocumentUriUsingTree(tree,cursor.getString(0)).toString()));
            }
        } else {
            File dir=new File(p.getString("path")); File[] entries=dir.listFiles();
            if(entries==null) throw new IOException("Directory unavailable or permission denied");
            for(File file:entries) out.put(new JSONObject().put("name",file.getName()).put("path",file.getAbsolutePath()).put("directory",file.isDirectory()).put("size",file.length()).put("modified",file.lastModified()));
        }
        return out;
    }
}
