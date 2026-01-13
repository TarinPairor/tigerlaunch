import cv2
from ultralytics import YOLO
import subprocess
import webbrowser
import time
import os
import sys

# Load the YOLOv8 model (the default pretrained)
model = YOLO('yolo11n.pt')  # you can use 'yolov8s.pt' for more accuracy

# Open the webcam (global for cleanup)
cap = cv2.VideoCapture(1)  # 0 is the default camera

# Track consecutive person detections
consecutive_person_frames = 0
consecutive_no_person_frames = 0
REQUIRED_CONSECUTIVE_FRAMES = 5
FRAMES_TO_SHUTDOWN = 15  # Frames without person before shutting down
triggered = False  # Flag to prevent multiple triggers

# Store subprocess references
dev_server_process = None
audio_analysis_process = None

def trigger_pipeline():
    """Trigger the pipeline: start dev server, open browser, run audio analysis"""
    global dev_server_process, audio_analysis_process, triggered
    
    if triggered:
        return  # Already triggered, don't run again
    
    triggered = True
    print("\n" + "="*60)
    print("🚀 PERSON DETECTED! Starting pipeline...")
    print("="*60)
    
    try:
        # 1. Start pnpm run dev (in background)
        print("📦 Starting dev server (pnpm run dev)...")
        dev_server_process = subprocess.Popen(
            ['pnpm', 'start'],
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            cwd=os.path.dirname(os.path.abspath(__file__))
        )
        print("   ✓ Dev server started (PID: {})".format(dev_server_process.pid))
        
        # 2. Wait a bit for server to start, then open browser
        print("⏳ Waiting for server to start...")
        time.sleep(3)  # Give server time to start
        
        print("🌐 Opening browser to http://localhost:3000...")
        webbrowser.open('http://localhost:3000')
        print("   ✓ Browser opened")
        
        # 3. Run audio analysis script (in background)
        print("🎤 Starting real-time audio analysis...")
        script_path = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'realtime_audio_analysis.py')
        audio_analysis_process = subprocess.Popen(
            [sys.executable, script_path],
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE
        )
        print("   ✓ Audio analysis started (PID: {})".format(audio_analysis_process.pid))
        
        print("\n✅ Pipeline activated!")
        print("   - Dev server running on http://localhost:3000")
        print("   - Browser opened")
        print("   - Audio analysis running")
        print("\nPress 'q' to exit and stop all processes\n")
        
    except Exception as e:
        print(f"❌ Error starting pipeline: {e}")
        triggered = False  # Allow retry on error

def shutdown_pipeline_and_exit():
    """Shutdown all processes and exit program when person leaves"""
    global dev_server_process, audio_analysis_process, triggered, consecutive_no_person_frames
    
    print("\n" + "="*60)
    print("👋 PERSON LEFT! Exiting program...")
    print("="*60)
    
    try:
        # Stop dev server
        if dev_server_process:
            print("   Stopping dev server...")
            dev_server_process.terminate()
            try:
                dev_server_process.wait(timeout=3)
                print("   ✓ Dev server stopped")
            except subprocess.TimeoutExpired:
                print("   ⚠ Dev server didn't stop, killing...")
                dev_server_process.kill()
                dev_server_process.wait()
            dev_server_process = None
        
        # Stop audio analysis
        if audio_analysis_process:
            print("   Stopping audio analysis...")
            audio_analysis_process.terminate()
            try:
                audio_analysis_process.wait(timeout=3)
                print("   ✓ Audio analysis stopped")
            except subprocess.TimeoutExpired:
                print("   ⚠ Audio analysis didn't stop, killing...")
                audio_analysis_process.kill()
                audio_analysis_process.wait()
            audio_analysis_process = None
        
        # Try to close browser (macOS)
        try:
            if sys.platform == 'darwin':  # macOS
                subprocess.run(['osascript', '-e', 'tell application "Safari" to close windows whose URL contains "localhost:3000"'], 
                             capture_output=True, timeout=2)
                subprocess.run(['osascript', '-e', 'tell application "Google Chrome" to close tabs whose URL contains "localhost:3000"'], 
                             capture_output=True, timeout=2)
                subprocess.run(['osascript', '-e', 'tell application "Microsoft Edge" to close tabs whose URL contains "localhost:3000"'], 
                             capture_output=True, timeout=2)
        except:
            pass  # Browser closing is best-effort
        
        print("\n✅ All processes stopped!")
        print("   Exiting program...\n")
        
    except Exception as e:
        print(f"❌ Error shutting down: {e}")
    
    # Cleanup OpenCV
    cap.release()
    cv2.destroyAllWindows()
    
    # Exit program
    sys.exit(0)

while True:
    ret, frame = cap.read()
    if not ret:
        break

    # Perform detection
    # The model expects BGR images (as provided by OpenCV)
    results = model(frame)
    # results[0] is the first image's detection

    annotated_frame = frame.copy()
    person_detected = False

    for box in results[0].boxes:
        cls_id = int(box.cls[0])
        if model.model.names[cls_id] == "person":
            person_detected = True
            x1, y1, x2, y2 = map(int, box.xyxy[0])
            conf = float(box.conf[0])
            # Draw bounding box
            cv2.rectangle(annotated_frame, (x1, y1), (x2, y2), (0, 255, 0), 2)
            label = f'Person: {conf:.2f}'
            cv2.putText(annotated_frame, label, (x1, y1 - 10),
                        cv2.FONT_HERSHEY_SIMPLEX, 0.8, (0, 255, 0), 2)
    
    # Update consecutive frame counter
    if person_detected:
        consecutive_person_frames += 1
        consecutive_no_person_frames = 0  # Reset no-person counter
        
        # Draw counter on frame
        # cv2.putText(annotated_frame, f'Consecutive: {consecutive_person_frames}/{REQUIRED_CONSECUTIVE_FRAMES}',
        #            (10, 30), cv2.FONT_HERSHEY_SIMPLEX, 1, (0, 255, 0), 2)
        
        # Trigger pipeline if we hit the threshold
        if consecutive_person_frames >= REQUIRED_CONSECUTIVE_FRAMES and not triggered:
            trigger_pipeline()
    else:
        consecutive_person_frames = 0
        
        # If pipeline is active and person is gone, count frames
        if triggered:
            consecutive_no_person_frames += 1
            
            # Show countdown on frame
            remaining = FRAMES_TO_SHUTDOWN - consecutive_no_person_frames
            if remaining > 0:
                cv2.putText(annotated_frame, f'Person left - Exiting in: {remaining} frames',
                           (10, 30), cv2.FONT_HERSHEY_SIMPLEX, 0.7, (0, 165, 255), 2)
            
            # Exit program if person has been gone for enough frames
            if consecutive_no_person_frames >= FRAMES_TO_SHUTDOWN:
                shutdown_pipeline_and_exit()
    
    # Show status
    if triggered and person_detected:
        cv2.putText(annotated_frame, 'PIPELINE ACTIVE', (10, 30),
                   cv2.FONT_HERSHEY_SIMPLEX, 0.7, (0, 255, 0), 2)

    cv2.imshow('YOLOv8 Person Detection', annotated_frame)

    # Press 'q' to exit
    if cv2.waitKey(1) & 0xFF == ord('q'):
        break

# Cleanup on manual exit (Ctrl+C or 'q')
print("\n🛑 Exiting - stopping all processes...")
if dev_server_process:
    print("   Stopping dev server...")
    dev_server_process.terminate()
    try:
        dev_server_process.wait(timeout=3)
    except subprocess.TimeoutExpired:
        dev_server_process.kill()
        dev_server_process.wait()
if audio_analysis_process:
    print("   Stopping audio analysis...")
    audio_analysis_process.terminate()
    try:
        audio_analysis_process.wait(timeout=3)
    except subprocess.TimeoutExpired:
        audio_analysis_process.kill()
        audio_analysis_process.wait()

cap.release()
cv2.destroyAllWindows()
print("✅ Cleanup complete. Goodbye!")
