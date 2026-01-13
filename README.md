TigerLaunch Demo Workflow – Daily Morning Check-in

1. Elderly person approaches mirror/tablet  
- Idle mirror screen  
- Presence detected or user taps “Start”  
- System wakes screen, starts session timer, assigns session ID  

2. System greets user  
- Mirror says: “Good morning, Mary. How are you feeling today?”  
- Audio recording starts  
- Log: session start time, pseudonymous user ID  

3. User responds naturally (10–30s)  
- Free speech response  
- System records audio  
- Measures: speaking time, silence duration, rough speech rate  (word/sec)
- Optional: face detected (yes/no), smile detected (yes/no)  

4. System closes interaction  
- Mirror says: “Thank you, Mary. Have a nice day.”  
- Audio stops  
- Log: interaction duration, completion status  

5. Data stored longitudinally  
- Per-user daily record (date, duration, speech activity, speech rate, face presence)  
- Stored locally or in cloud DB  

6. Trend computation  
- Compare today vs past days  
- Compute interaction frequency, avg duration, speech activity trend  

7. Dashboard update  
- Line charts of interaction frequency & duration  
- Simple flag: “Interaction duration decreased this week”  
- Clearly labeled: “Behavioral signal – not diagnosis”  

8. Optional future follow-up  
- Caregiver notification  
- Suggest observation (no clinical claim)  

Implemented: greeting, audio capture, logging, basic trends  
Simulated: advanced speech/emotion analysis  
Future: multimodal fusion, clinical correlation, hardware integration# tigerlaunch
