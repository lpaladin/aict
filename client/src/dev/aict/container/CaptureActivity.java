package dev.aict.container;

import android.app.Activity;
import android.content.*;
import android.content.pm.PackageManager;
import android.graphics.SurfaceTexture;
import android.hardware.Camera;
import android.net.Uri;
import android.os.*;
import android.provider.MediaStore;
import android.view.*;
import android.widget.*;
import org.json.*;
import java.io.*;
import java.util.*;
import java.util.concurrent.ConcurrentHashMap;

/** Visible native camera host. Android background/permission rules still apply. */
@SuppressWarnings("deprecation")
public final class CaptureActivity extends Activity implements TextureView.SurfaceTextureListener {
    private static final Map<String,NativeRuntime.Reply> WAITING=new ConcurrentHashMap<>();
    private JSONObject options;
    private String id;
    private Camera camera;
    private TextureView preview;
    private File output;
    private boolean finished,shooting,video;
    public static void launch(Context context,JSONObject params,boolean video,NativeRuntime.Reply reply,String id) {
        if(WAITING.putIfAbsent(id,reply)!=null) throw new IllegalArgumentException("Capture already exists");
        new Handler(Looper.getMainLooper()).postDelayed(()->{NativeRuntime.Reply pending=WAITING.remove(id);if(pending!=null)pending.send(NativeRuntime.error(id,new IllegalStateException("Camera launch/capture timed out; check foreground restrictions")));},180000);
        new Handler(Looper.getMainLooper()).post(()->{
            try { context.startActivity(new Intent(context,CaptureActivity.class).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK).putExtra("id",id).putExtra("options",params.toString()).putExtra("video",video)); }
            catch(Exception e){NativeRuntime.Reply pending=WAITING.remove(id);if(pending!=null)pending.send(NativeRuntime.error(id,e));}
        });
    }
    @Override public void onCreate(Bundle state) {
        super.onCreate(state);
        id=getIntent().getStringExtra("id");video=getIntent().getBooleanExtra("video",false);
        try {
            options=new JSONObject(getIntent().getStringExtra("options"));
            output=new File(options.optString("path",new File(getExternalFilesDir(Environment.DIRECTORY_DCIM),"capture-"+System.currentTimeMillis()+(video?".mp4":".jpg")).getAbsolutePath()));
            if(!output.getParentFile().isDirectory()&&!output.getParentFile().mkdirs())throw new IOException("Cannot create output directory");
            if(checkSelfPermission("android.permission.CAMERA")!=PackageManager.PERMISSION_GRANTED){requestPermissions(new String[]{"android.permission.CAMERA"},41);return;}
            begin();
        }catch(Exception e){complete(null,e);}
    }
    private void begin() throws Exception {
        if(video) {
            Uri uri=(Uri)Class.forName("androidx.core.content.FileProvider").getMethod("getUriForFile",Context.class,String.class,File.class).invoke(null,this,getPackageName()+".fileprovider",output);
            Intent intent=new Intent(MediaStore.ACTION_VIDEO_CAPTURE).putExtra(MediaStore.EXTRA_OUTPUT,uri)
                .addFlags(Intent.FLAG_GRANT_WRITE_URI_PERMISSION|Intent.FLAG_GRANT_READ_URI_PERMISSION);
            if(options.has("durationSeconds"))intent.putExtra(MediaStore.EXTRA_DURATION_LIMIT,options.getInt("durationSeconds"));
            intent.setClipData(ClipData.newRawUri("video",uri));startActivityForResult(intent,42);return;
        }
        LinearLayout layout=new LinearLayout(this);layout.setOrientation(LinearLayout.VERTICAL);
        preview=new TextureView(this);preview.setSurfaceTextureListener(this);layout.addView(preview,new LinearLayout.LayoutParams(-1,0,1));
        Button button=new Button(this);button.setText("拍照");button.setOnClickListener(v->takePhoto());layout.addView(button);
        setContentView(layout);
    }
    @Override public void onSurfaceTextureAvailable(SurfaceTexture texture,int width,int height) {
        try {
            int cameraId=options.optInt("cameraId",-1);
            if(cameraId<0) {
                int facing="front".equals(options.optString("lens"))?Camera.CameraInfo.CAMERA_FACING_FRONT:Camera.CameraInfo.CAMERA_FACING_BACK;
                for(int i=0;i<Camera.getNumberOfCameras();i++){Camera.CameraInfo info=new Camera.CameraInfo();Camera.getCameraInfo(i,info);if(info.facing==facing){cameraId=i;break;}}
            }
            if(cameraId<0)throw new IllegalStateException("Requested camera unavailable");
            camera=Camera.open(cameraId);
            Camera.CameraInfo info=new Camera.CameraInfo();Camera.getCameraInfo(cameraId,info);
            int degrees=getWindowManager().getDefaultDisplay().getRotation()*90;
            int rotation=info.facing==Camera.CameraInfo.CAMERA_FACING_FRONT?(info.orientation+degrees)%360:(info.orientation-degrees+360)%360;
            camera.setDisplayOrientation(info.facing==Camera.CameraInfo.CAMERA_FACING_FRONT?(360-rotation)%360:rotation);
            Camera.Parameters params=camera.getParameters();params.setRotation(rotation);params.setJpegQuality(Math.max(1,Math.min(100,options.optInt("quality",90))));
            List<String> modes=params.getSupportedFocusModes();if(modes!=null&&modes.contains(Camera.Parameters.FOCUS_MODE_CONTINUOUS_PICTURE))params.setFocusMode(Camera.Parameters.FOCUS_MODE_CONTINUOUS_PICTURE);
            camera.setParameters(params);camera.setPreviewTexture(texture);camera.startPreview();
            if(options.optBoolean("autoCapture",true))preview.postDelayed(this::takePhoto,800);
        }catch(Exception e){complete(null,e);}
    }
    private void takePhoto(){
        if(camera==null||shooting)return;shooting=true;
        try{camera.takePicture(null,null,(data,c)->{
            try(FileOutputStream stream=new FileOutputStream(output)){stream.write(data);complete(new JSONObject().put("path",output.getAbsolutePath()).put("bytes",data.length).put("mime","image/jpeg"),null);}
            catch(Exception e){complete(null,e);}
        });}catch(Exception e){complete(null,e);}
    }
    private void complete(JSONObject result,Throwable error){
        if(finished)return;finished=true;
        NativeRuntime.Reply reply=WAITING.remove(id);
        if(reply!=null)reply.send(error==null?NativeRuntime.ok(id,result):NativeRuntime.error(id,error));finish();
    }
    @Override protected void onActivityResult(int request,int result,Intent data){super.onActivityResult(request,result,data);if(request==42){try{if(result!=RESULT_OK)throw new IOException("Video capture cancelled");if(!output.isFile()&&data!=null&&data.getData()!=null){try(InputStream in=getContentResolver().openInputStream(data.getData());OutputStream out=new FileOutputStream(output)){byte[] b=new byte[65536];int n;while((n=in.read(b))!=-1)out.write(b,0,n);}}if(!output.isFile())throw new IOException("Camera did not return a video file");complete(new JSONObject().put("path",output.getAbsolutePath()).put("bytes",output.length()).put("mime","video/mp4"),null);}catch(Exception e){complete(null,e);}}}
    @Override public void onRequestPermissionsResult(int code,String[] p,int[] results){super.onRequestPermissionsResult(code,p,results);if(code==41){try{if(results.length==0||results[0]!=PackageManager.PERMISSION_GRANTED)throw new SecurityException("Camera permission denied");begin();}catch(Exception e){complete(null,e);}}}
    @Override public void onSurfaceTextureSizeChanged(SurfaceTexture t,int w,int h){}
    @Override public void onSurfaceTextureUpdated(SurfaceTexture t){}
    @Override public boolean onSurfaceTextureDestroyed(SurfaceTexture t){release();return true;}
    private void release(){if(camera!=null){camera.release();camera=null;}}
    @Override protected void onPause(){super.onPause();if(!video&&camera!=null){release();if(!finished)complete(null,new IOException("Camera activity left foreground"));}}
    @Override protected void onDestroy(){release();if(isFinishing()&&!finished)complete(null,new IOException("Capture cancelled"));super.onDestroy();}
}
