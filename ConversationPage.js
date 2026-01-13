import React, { useEffect, useRef, useState } from "react";
import translations from "../Components/translation";
import { useNavigate, useLocation } from "react-router-dom";
import { useLanguage } from "../Components/LanguageContext";
import { useAuth } from '../Components/AuthContext';
import GameProgressUI from "../Components/GameProgressUI";
import './ConversationPage.css';

// Import game mode icons
import { KeyboardIcon, MicIcon, SendIcon, SettingsIcon, CloseIcon } from '../Components/Icons';
import creepyIcon from '../assets/images/creppy.png';
import happyIcon from '../assets/images/happy.png';
import naturalIcon from '../assets/images/natural.png';
import yeyIcon from '../assets/images/yey.png';

function ConversationPage() {
    const location = useLocation();
    const navigate = useNavigate();
    const { selectedLanguage } = useLanguage();
    const t = translations[selectedLanguage] || translations['en'];

    // --- Mode from Navigation ---
    const { mode = 'hsk' } = location.state || {};

    const { user } = useAuth();
    const [userMemory, setUserMemory] = useState(null);
    const [memoryLoading, setMemoryLoading] = useState(false);
    const [memoryError, setMemoryError] = useState(null);

    // --- Refs (Ensure all original refs are present) ---
    const peerConnection = useRef(null);
    const audioElement = useRef(null);
    const audioContextRef = useRef(null);
    const analyserRef = useRef(null);
    const animationFrameRef = useRef(null);
    const serverAudioStreamRef = useRef(null);
    const userAudioTrackRef = useRef(null);
    const silenceTimeoutRef = useRef(null);
    const isMouthOpen = useRef(false);
    const messageTextRef = useRef(null);
    const textInputRef = useRef(null);
    const pttStopTimeoutRef = useRef(null);
    const messagesContainerRef = useRef(null);

    // --- State (Keep original + add settings state) ---
    const [isSessionActive, setIsSessionActive] = useState(false);
    const [isTalking, setIsTalking] = useState(false); // State for PTT
    const [messageText, setMessageText] = useState(t.welcomeMessage || t.welcomeMessage);
    const [dataChannel, setDataChannel] = useState(null);
    const [splineFullyLoaded, setSplineFullyLoaded] = useState(true); // Set to true since we're removing Spline
    const [splineObj, setSplineObj] = useState(null);
    const [isTextInputMode, setIsTextInputMode] = useState(true);
    const [userTextInput, setUserTextInput] = useState("");

    // --- State for Settings Panel ---
    const [isSettingsOpen, setIsSettingsOpen] = useState(false);
    // Temporary selections within the panel
    const [selectedGameTypeInfo, setSelectedGameTypeInfo] = useState(null); // For play mode { key, name, desc }
    const [selectedLevel, setSelectedLevel] = useState(null);
    const [selectedTopic, setSelectedTopic] = useState(null); // The whole topic object
    const [selectedChunkData, setSelectedChunkData] = useState(null); // { type: 'word'/'sentence', chunk: [...] }
    const [cachedLessons, setCachedLessons] = useState({}); // Cache lessons to avoid refetching {type: Lesson[]}

    // Fetched data for the panel
    const [lessons, setLessons] = useState([]); // Lessons for selected level
    const [loadingSettings, setLoadingSettings] = useState(false);
    const [settingsError, setSettingsError] = useState(null);
    // Final confirmed settings used to start session
    const [confirmedSettings, setConfirmedSettings] = useState({
        mode: mode, // Store the mode passed from MainPage
        level: null,
        topicTitle: null,
        englishTitle: null,
        phrases: [], // Populated from word chunk
        conversation: [], // Populated from sentence chunk
        gameType: null, // 'guess', 'reverse', 'sentence-maker'
        gameName: null, // Game display name
        gameDesc: null, // Game description
    });

    // --- Game state tracking --- (Keep as original)
    const [currentWordIndex, setCurrentWordIndex] = useState(0);
    const [missedWords, setMissedWords] = useState([]);
    const [correctAnswers, setCorrectAnswers] = useState(0);

    const [conversationHistory, setConversationHistory] = useState([]);
    const [chunkSelectionType, setChunkSelectionType] = useState('word');
    const [talkModeWords, setTalkModeWords] = useState([]);

    const [convoStarted, setConvoStarted] = useState(false)
    const [isStartingSession, setIsStartingSession] = useState(false);

    // --- Utility Functions (Moved from MainPage) ---
    const fetchLessons = async (hskLevel) => {
        if (!hskLevel) return;

        // Check if we already have cached data for this level
        if (cachedLessons[hskLevel]?.length > 0) {
            setLessons(cachedLessons[hskLevel]);
            setLoadingSettings(false);
            return;
        }

        setLoadingSettings(true);
        setSettingsError(null);
        setLessons([]); // Clear previous lessons
        try {
            // Ensure the API URL is correctly defined in your .env file
            const apiUrl = process.env.REACT_APP_API_URL;
            if (!apiUrl) {
                throw new Error("API URL is not configured. Please set REACT_APP_API_URL environment variable.");
            }
            const response = await fetch(`${apiUrl}/lessons?hskLevel=${hskLevel}`);
            if (!response.ok) {
                const errorData = await response.text(); // Get more error details
                throw new Error(`Failed to fetch lessons (Status: ${response.status}). ${errorData}`);
            }
            const data = await response.json();
            setLessons(data);
            setCachedLessons(prev => ({
                ...prev,
                [hskLevel]: data
            }));
        } catch (err) {
            console.error('Error fetching lessons:', err);
            setSettingsError(`Could not load topics: ${err.message}`);
        } finally {
            setLoadingSettings(false);
        }
    };

    const createWordChunks = (words, chunkSize = 5) => {
        if (!words || !words.length) return [];
        const chunks = [];
        for (let i = 0; i < words.length; i += chunkSize) {
            chunks.push(words.slice(i, i + chunkSize));
        }
        return chunks;
    };

    const createSentenceChunks = (sentences, chunkSize = 4) => {
        if (!sentences || !sentences.length) return [];
        const chunks = [];
        for (let i = 0; i < sentences.length; i += chunkSize) {
            chunks.push(sentences.slice(i, i + chunkSize));
        }
        return chunks;
    };

    useEffect(() => {
        async function fetchTalkModeWords() {
          if (confirmedSettings.mode === 'talk' && confirmedSettings.level) {
            try {
              const apiUrl = process.env.REACT_APP_API_URL;
              const res = await fetch(`${apiUrl}/hsk_words?level=${confirmedSettings.level}`);
              const data = await res.json();
              setTalkModeWords(data.words || []);
            } catch (error) {
              console.error("Failed to fetch talk mode words:", error);
              setTalkModeWords([]);
            }
          }
        }
      
        fetchTalkModeWords();
    }, [confirmedSettings.level, confirmedSettings.mode]);
      

    useEffect(() => {
        if (confirmedSettings.mode === 'talk' && user?.id) {
            setMemoryLoading(true);
            setMemoryError(null);
            
            const apiUrl = process.env.REACT_APP_API_URL;
            const memoryUrl = `${apiUrl}/memory/user_state/${user.id}`;
            
            console.log("Fetching memory from:", memoryUrl);
            
            fetch(memoryUrl)
                .then(response => {
                    // Important change: we EXPECT a 404 for new users
                    if (response.status === 404) {
                        console.log("User has no memory yet (404) - this is expected for new users");
                        // Return empty object to signal initialization needed
                        return {};
                    }
                    
                    if (!response.ok) {
                        throw new Error(`Unexpected error: ${response.status}`);
                    }
                    
                    return response.json();
                })
                .then(data => {
                    // Check if memory exists or is empty
                    if (!data || Object.keys(data).length === 0) {
                        console.log("Initializing new user memory");
                        
                        // Create initial memory with basic user info
                        const initialMemory = {
                            username: user.name,
                            firstInteraction: new Date().toISOString()
                        };
                        
                        // Store initial memory
                        fetch(`${apiUrl}/memory/store`, {
                            method: "POST",
                            headers: { "Content-Type": "application/json" },
                            body: JSON.stringify({
                                user_id: user.id,
                                message: `Initial user profile created: ${JSON.stringify(initialMemory)}`
                            })
                        })
                        .then(storeResponse => {
                            if (!storeResponse.ok) {
                                console.warn("Failed to store initial memory");
                            } else {
                                console.log("Initial memory stored successfully");
                            }
                            
                            // Use the memory regardless of storage success
                            setUserMemory(initialMemory);
                            setMemoryLoading(false);
                        })
                        .catch(storeError => {
                            console.error("Error storing initial memory:", storeError);
                            setUserMemory(initialMemory);
                            setMemoryLoading(false);
                        });
                    } else {
                        console.log("Existing memory found");
                        console.log("memory is", data)
                        setUserMemory(data);
                        setMemoryLoading(false);
                    }
                })
                .catch(error => {
                    console.error("Error in memory flow:", error);
                    
                    // Create a basic memory even if there was an error
                    const fallbackMemory = {
                        username: user.name,
                        note: "Created as fallback due to API error"
                    };
                    
                    setUserMemory(fallbackMemory);
                    setMemoryError(error.message);
                    setMemoryLoading(false);
                });
        }
    }, [confirmedSettings.mode, user?.id]);

    // Effect for Mouth Animation/Audio Analysis Setup
    useEffect(() => {
        if (isSessionActive && splineObj && serverAudioStreamRef.current && !audioContextRef.current) {
            setupAudioAnalysis();
        }
        return () => {
            if (audioContextRef.current) {
                audioContextRef.current.close().catch(e => console.error("Error closing audio context:", e));
                audioContextRef.current = null;
            }
            if (animationFrameRef.current) {
                cancelAnimationFrame(animationFrameRef.current);
                animationFrameRef.current = null;
            }
            closeMouth();
        };
        // Dependencies should reflect what triggers setup/cleanup
    }, [isSessionActive, splineObj]); // Removed serverAudioStreamRef.current as it's a ref, check if needed

    // Effect for Scrolling Message Box - Modified to use messagesContainerRef
    useEffect(() => {
        if (messagesContainerRef.current) {
            messagesContainerRef.current.scrollTop = messagesContainerRef.current.scrollHeight;
        }
    }, [conversationHistory]);

    // Effect for Browser Back/Forward Navigation
    useEffect(() => {
        const handlePopState = () => {
            console.log("Popstate detected, stopping session if active.");
            if (isSessionActive) {
                stopSession();
            }
            // navigate(-1); // Optional: Force back navigation
        };
        window.addEventListener("popstate", handlePopState);
        return () => {
            window.removeEventListener("popstate", handlePopState);
        };
        // Ensure isSessionActive and navigate are dependencies if used inside
    }, [isSessionActive, navigate]);

    // Effect for Handling Data Channel Events
    useEffect(() => {
        if (!dataChannel) return;
        const handleMessageEvent = (e) => handleMessage(e);
        const handleOpen = () => handleChannelOpen();
        const handleClose = () => handleChannelClosed();
        const handleError = (error) => handleChannelError(error);

        dataChannel.addEventListener("message", handleMessageEvent);
        // Important: Check readyState before adding 'open' listener
        if (dataChannel.readyState !== 'open') {
             dataChannel.addEventListener("open", handleOpen);
        } else {
            // If already open when effect runs (e.g., fast reconnect), manually trigger
            handleChannelOpen();
        }
        dataChannel.addEventListener("close", handleClose);
        dataChannel.addEventListener("error", handleError);

        return () => {
             if (dataChannel) { // Check if dataChannel exists before removing listeners
                dataChannel.removeEventListener("message", handleMessageEvent);
                dataChannel.removeEventListener("open", handleOpen);
                dataChannel.removeEventListener("close", handleClose);
                dataChannel.removeEventListener("error", handleError);
            }
        };
        // Rerun this effect ONLY if the dataChannel instance itself changes
    }, [dataChannel]);

    // Effect for Monitoring Peer Connection State
     useEffect(() => {
        const pc = peerConnection.current; // Capture ref value for the effect closure
        if (!pc) return;

        const handleConnectionStateChange = () => {
            console.log("Connection state changed:", pc?.connectionState);
            if (pc?.connectionState === 'disconnected' || pc?.connectionState === 'failed' || pc?.connectionState === 'closed') {
                console.log("Connection lost, cleaning up session");
                stopSession(); // Call cleanup function
            }
        };
        const handleIceConnectionStateChange = () => {
            console.log("ICE connection state changed:", pc?.iceConnectionState);
             if (pc?.iceConnectionState === 'disconnected' || pc?.iceConnectionState === 'failed' || pc?.iceConnectionState === 'closed') {
                console.log("ICE connection lost, cleaning up session");
                stopSession(); // Call cleanup function
            }
        };

        pc.addEventListener('connectionstatechange', handleConnectionStateChange);
        pc.addEventListener('iceconnectionstatechange', handleIceConnectionStateChange);

        // Cleanup function
        return () => {
             if (pc) { // Use the captured pc instance
                pc.removeEventListener('connectionstatechange', handleConnectionStateChange);
                pc.removeEventListener('iceconnectionstatechange', handleIceConnectionStateChange);
            }
        };
        // Rerun this effect only if the peerConnection.current instance changes
    }, [peerConnection.current]);

    useEffect(() => {
        if (
          (mode === 'talk' || mode === 'hsk' || mode === 'play') && 
          !confirmedSettings.level
        ) {
          setMessageText(t.selectLevelPrompt || "Please select your HSK level.");
          setIsSettingsOpen(true);
        }
      }, []);

    // Effect for Clearing Silence Timeout on Unmount
    useEffect(() => {
        // Cleanup function runs on unmount
        return () => {
            if (silenceTimeoutRef.current) {
                clearTimeout(silenceTimeoutRef.current);
            }
             if (pttStopTimeoutRef.current) { // Also clear PTT timeout on unmount
                clearTimeout(pttStopTimeoutRef.current);
            }
        };
        // No dependencies needed as it only runs on unmount
    }, []);

    // Effect to focus input when switching to text mode
    useEffect(() => {
        if (isTextInputMode && textInputRef.current) {
            textInputRef.current.focus();
        }
    }, [isTextInputMode]);

    // --- Spline/Audio Analysis Functions (Keep Original Implementations) ---
    function openMouth() {
        if (!isMouthOpen.current && splineObj && isSessionActive) {
            splineObj.emitEvent("keyDown", "Mouth");
            isMouthOpen.current = true;
            // console.log("Mouth Opened"); // Debug log
        }
    }

    function closeMouth() {
        if (isMouthOpen.current && splineObj) {
            splineObj.emitEvent("keyUp", "Mouth");
            isMouthOpen.current = false;
            // console.log("Mouth Closed"); // Debug log
        }
         // Also clear silence timer if closing mouth manually
        if (silenceTimeoutRef.current) {
             clearTimeout(silenceTimeoutRef.current);
             silenceTimeoutRef.current = null;
         }
    }

    function setupAudioAnalysis() {
         if (audioContextRef.current || !serverAudioStreamRef.current || !isSessionActive) {
            // console.log("Skipping audio analysis setup:", { hasCtx: !!audioContextRef.current, hasStream: !!serverAudioStreamRef.current, active: isSessionActive });
            return;
         }
         try {
            console.log("Setting up audio analysis for server stream");
            audioContextRef.current = new (window.AudioContext || window.webkitAudioContext)();
            // Ensure stream is active before creating source
            if (!serverAudioStreamRef.current.active) {
                 console.warn("Server audio stream is not active.");
                 audioContextRef.current.close(); audioContextRef.current = null; return;
            }
            const source = audioContextRef.current.createMediaStreamSource(serverAudioStreamRef.current);
            const analyser = audioContextRef.current.createAnalyser();
            analyser.fftSize = 256; // Lower resolution is fine for volume detection
            analyser.smoothingTimeConstant = 0.3; // Some smoothing
            source.connect(analyser);
            analyserRef.current = analyser;

            const checkAudioLevel = () => {
                 if (!isSessionActive || !analyserRef.current || audioContextRef.current?.state === 'closed') {
                    closeMouth();
                    if (animationFrameRef.current) {
                        cancelAnimationFrame(animationFrameRef.current);
                        animationFrameRef.current = null;
                    }
                    // console.log("Stopping audio analysis loop."); // Debug log
                    return;
                }
                const dataArray = new Uint8Array(analyserRef.current.frequencyBinCount);
                analyserRef.current.getByteFrequencyData(dataArray);
                let sum = 0;
                // Only sample lower frequencies for speech detection
                const relevantBins = Math.floor(dataArray.length * 0.3); // Analyze lower 30% of bins
                for (let i = 0; i < relevantBins; i++) sum += dataArray[i];
                const average = relevantBins > 0 ? sum / relevantBins : 0;
                const threshold = 15; // Adjust this threshold based on testing

                // console.log("Audio Level:", average); // Debug log

                if (average > threshold) {
                    openMouth();
                     // Clear any pending silence timeout
                     if (silenceTimeoutRef.current) {
                         clearTimeout(silenceTimeoutRef.current);
                         silenceTimeoutRef.current = null;
                     }
                } else {
                    // If mouth is open and no silence timeout is set, start one
                    if (isMouthOpen.current && !silenceTimeoutRef.current) {
                        silenceTimeoutRef.current = setTimeout(() => {
                            closeMouth();
                            silenceTimeoutRef.current = null; // Clear the ref after timeout fires
                        }, 150); // Close mouth after 150ms of silence
                    } else if (!isMouthOpen.current && silenceTimeoutRef.current) {
                        // If mouth is already closed but a timeout exists (shouldn't happen often), clear it
                        clearTimeout(silenceTimeoutRef.current);
                        silenceTimeoutRef.current = null;
                    }
                }
                animationFrameRef.current = requestAnimationFrame(checkAudioLevel);
            };
            checkAudioLevel();
         } catch (error) {
             console.error("Audio setup error:", error);
             if (audioContextRef.current) audioContextRef.current.close().catch(e => {}); // Safe close
             audioContextRef.current = null;
             analyserRef.current = null;
         }
    }

    // --- WebRTC Data Channel Handlers (Keep Original Implementations) ---
    function handleMessage(e) {
        try {
            const message = JSON.parse(e.data);
            setConvoStarted(true)
            // console.log("RAW MSG RECEIVED:", JSON.stringify(message, null, 2));
            if (message.type === "response.audio_transcript.delta" && message.delta) {
                setMessageText((prev) => prev + message.delta);
            } else if (message.type === "conversation.item.created" && message.item?.type === 'response') {
                // Clear previous message/transcript when AI starts responding *fully*
                // Check if content exists might be better than just type === 'response'
                if(message.item.content && message.item.content.length > 0) {
                    setMessageText(""); // Clear space for AI response
                }
            } else if (message.type === 'response.function_call_arguments.done') {
                 handleFunctionCall(message);
            } else if (message.type === "session.ended" || message.type === "error" || message.type === "session.error") {
                console.log("Received session end or error notification:", message);
                stopSession(); // Trigger cleanup and state reset
            } else if (message.type === "response.done") {
                const aiText = message?.response?.output?.[0]?.content?.[0]?.transcript;
                if (aiText) {
                    console.log("AI SAY:", aiText);
                    setConversationHistory(prev => [...prev, { role: 'assistant', content: aiText }]);
                    setMessageText(""); // Clear the streaming message text after it's added to conversation history
                }
            } else if (message.type === "conversation.item.input_audio_transcription.completed") {
                console.log("USER SAY:", message.transcript)
                setConversationHistory(prev => [...prev, { role: 'user', content: message.transcript }]);
            }

        } catch (error) {
            console.error("Error parsing or handling message:", error, "Raw data:", e.data);
        }
    }

    function handleChannelOpen() {
        console.log("Data channel opened");
        // Session becomes active only AFTER connection established
        setIsSessionActive(true);
        setMessageText(""); // Clear initial message like "Connecting..."

        // Reset game state if applicable (only relevant if starting game via settings)
         if (confirmedSettings.mode === 'play') {
            setCurrentWordIndex(0);
            setMissedWords([]);
            setCorrectAnswers(0);
         }

        // Prepare and send initial session configuration
        const prompt = generatePrompt(); // Generate prompt based on confirmedSettings
        const tools = defineTools(); // Define tools based on confirmedSettings

        const sessionUpdateEvent = {
            type: 'session.update',
            event_id: crypto.randomUUID(), // Add event ID
            session: {
                modalities: ['text', 'audio'], // Ensure both are listed
                tools: tools,
            },
        };
        sendClientEvent(sessionUpdateEvent); // Send config first

        // Send the initial prompt slightly after config
        // Check if prompt is valid before sending
        if (prompt && prompt.trim() && !prompt.startsWith("System: Error")) {
            setTimeout(() => {
                sendTextMessage(prompt); // This function wraps it in the correct event structure
            }, 150); // Slight delay for config to process
        } else if (prompt.startsWith("System: Error")) {
            // If prompt generation failed (e.g., no settings), show error
            setMessageText(prompt);
            stopSession(); // Stop session if config is invalid
            return;
        }


        console.log("Session configured and initial prompt sent (if valid).");
    }

    function handleChannelClosed() {
        console.log("Data channel closed");
        // Don't call stopSession here necessarily, connectionstatechange handles disconnections
        // Only reset channel-specific state if needed
        // setIsSessionActive(false); // Maybe handled by connectionstatechange?
    }

    function handleChannelError(error) {
        console.error("Data channel error:", error);
        stopSession(); // Treat data channel error as fatal for the session
    }

    // --- AI Interaction & Function Calling (Keep Original Implementations) ---

    function defineTools() {
        // This function now relies on `confirmedSettings` state
        const baseTools = [
            { type: 'function', name: "writeCharacter", description: "Triggers rendering and animation of a specific Chinese character.", parameters: { type: "object", properties: { character: { type: "string", description: "The Chinese character." } }, required: ["character"] } },
            { type: 'function', name: "reviewMissedWordsSuccess", description: "Confirms initiation of reviewing missed words. Call ONLY if the user agreed AND there are missed words.", parameters: { type: "object", properties: {}, required: [] } },
            { type: 'function', name: "reviewMissedWordsEmpty", description: "Reports that there are no missed words to review. Call ONLY if user asks to review but missedWords list is empty.", parameters: { type: "object", properties: {}, required: [] } },
            { type: 'function', name: "endSession", description: "Ends the conversation session gracefully. Call when the game/lesson concludes naturally or the user indicates they want to stop.", parameters: { type: "object", properties: { reason: { type: "string", description: "Brief reason for ending." } }, required: ["reason"] } },
        ];

        let gameTools = [];
        // Use confirmedSettings.mode and confirmedSettings.gameType here
        // if (confirmedSettings.mode === 'play' && confirmedSettings.gameType) {
        //     const commonParams = { userAnswer: "User's spoken/typed answer", correctWord: "Correct Chinese word", correctPinyin: "Correct Pinyin", correctMeaning: "Correct English Meaning" };
        //     switch (confirmedSettings.gameType) { // Use confirmed setting
        //         case 'guess': // EN -> CN
        //             gameTools = [
        //                 { name: "checkChineseGuessCorrect", description: "User's Chinese guess matched the target word.", params: { userAnswer: commonParams.userAnswer, correctWord: commonParams.correctWord, correctPinyin: commonParams.correctPinyin } },
        //                 { name: "checkChineseGuessIncorrect", description: "User's Chinese guess did NOT match the target word.", params: { userAnswer: commonParams.userAnswer, correctWord: commonParams.correctWord, correctPinyin: commonParams.correctPinyin } }
        //             ]; break;
        //         case 'reverse': // CN -> EN
        //              gameTools = [
        //                 { name: "checkEnglishMeaningCorrect", description: "User's English meaning for the Chinese word was correct.", params: { userAnswer: commonParams.userAnswer, chineseWord: commonParams.correctWord, correctMeaning: commonParams.correctMeaning } },
        //                 { name: "checkEnglishMeaningIncorrect", description: "User's English meaning for the Chinese word was incorrect.", params: { userAnswer: commonParams.userAnswer, chineseWord: commonParams.correctWord, correctMeaning: commonParams.correctMeaning } }
        //             ]; break;
        //         case 'sentence-maker': // Use word in sentence
        //              gameTools = [
        //                 { name: "checkSentenceCorrect", description: "User's sentence used the target Chinese word correctly and is contextually appropriate.", params: { userSentence: "User's spoken/typed sentence", targetWord: commonParams.correctWord, targetPinyin: commonParams.correctPinyin } },
        //                 { name: "checkSentenceIncorrect", description: "User's sentence did NOT use the target Chinese word correctly or is inappropriate.", params: { userSentence: "User's spoken/typed sentence", targetWord: commonParams.correctWord, targetPinyin: commonParams.correctPinyin } }
        //             ]; break;
        //          default: break;
        //     }
        // }

        // Format the dynamic game tools correctly
        const formattedGameTools = gameTools.map(tool => ({
            type: 'function',
            name: tool.name,
            description: tool.description,
            parameters: {
                type: "object",
                properties: Object.keys(tool.params).reduce((acc, key) => {
                    // Simple mapping, assuming string for now
                    acc[key] = { type: "string", description: tool.params[key] }; return acc;
                }, {}),
                required: Object.keys(tool.params) // Assume all params are required for now
            }
        }));

        return [...baseTools, ...formattedGameTools];
    }

    async function handleFunctionCall(message) {
         // Ensure message structure is valid
         if (!message || !message.name || !message.call_id) {
             console.error('Invalid function call message received:', message); return;
         }
        const { name: functionName, arguments: argsString, call_id } = message;
        let result;
        try {
            // Safely parse arguments, default to empty object if null/undefined/empty string
            const args = JSON.parse(argsString || '{}');
            console.log(`Executing function: ${functionName} with args:`, args);

            // Call the corresponding local function implementation
            switch (functionName) {
                case 'writeCharacter': result = await writeCharacter(args); break;
                case 'checkChineseGuessCorrect': result = await checkChineseGuessCorrect(args); break;
                case 'checkChineseGuessIncorrect': result = await checkChineseGuessIncorrect(args); break;
                case 'checkEnglishMeaningCorrect': result = await checkEnglishMeaningCorrect(args); break;
                case 'checkEnglishMeaningIncorrect': result = await checkEnglishMeaningIncorrect(args); break;
                case 'checkSentenceCorrect': result = await checkSentenceCorrect(args); break;
                case 'checkSentenceIncorrect': result = await checkSentenceIncorrect(args); break;
                case 'reviewMissedWordsSuccess': result = await reviewMissedWordsSuccess(); break;
                case 'reviewMissedWordsEmpty': result = await reviewMissedWordsEmpty(); break;
                case 'endSession': result = await endSession(args); break;
                default:
                    console.error('Unknown function called by AI:', functionName);
                    result = { success: false, message: `Unknown function: ${functionName}` };
            }
            console.log(`Function ${functionName} result:`, result);

            // Send the result back to the AI
            const event = {
                type: 'conversation.item.create',
                event_id: crypto.randomUUID(),
                item: {
                    type: 'function_call_output',
                    call_id: call_id,
                    // Ensure result is stringified, even if it's simple like {success: true}
                    output: JSON.stringify(result)
                 }
            };
            sendClientEvent(event);

            // IMPORTANT: Trigger the AI to generate its next response *after* sending the function output
             sendClientEvent({ type: "response.create", event_id: crypto.randomUUID() });

        } catch (error) {
            console.error(`Error handling function call ${functionName}:`, error);
            // Send an error result back to the AI
            const errorEvent = {
                type: 'conversation.item.create',
                event_id: crypto.randomUUID(),
                item: {
                    type: 'function_call_output',
                    call_id: call_id,
                    output: JSON.stringify({ success: false, message: `Error executing function: ${error.message}` })
                }
            };
            sendClientEvent(errorEvent);
             // Still trigger AI response even after an error in function execution
             sendClientEvent({ type: "response.create", event_id: crypto.randomUUID() });
        }
    }

    // --- Local Implementations of Functions Callable by AI (Keep Original Logic) ---
    async function writeCharacter({ character }) {
        console.log("UI Action: Write character", character);
        // In a real implementation, you might trigger an animation here
        return { success: true, characterDisplayed: character }; // Simple confirmation
    }
    async function reviewMissedWordsSuccess() {
        console.log("Starting review of missed words.");
        if (missedWords.length === 0) {
             return { success: false, message: "No missed words to review actually." };
        }
        // Logic to switch the game's word source to missedWords
        // For now, just reset index and acknowledge
        setCurrentWordIndex(0);
        // Maybe update confirmedSettings.phrases temporarily? Or handle in prompt generation?
        // setConfirmedSettings(prev => ({ ...prev, phrases: missedWords })); // Be careful with state updates
        console.log("Need logic to actually use missed words list for practice.");
        return { success: true, message: "Review session initiated.", totalMissed: missedWords.length };
    }
    async function reviewMissedWordsEmpty() {
        console.log("Reporting no missed words.");
        return { success: true, message: "No missed words available for review." };
    }
    async function endSession({ reason }) {
        console.log("Ending session by AI request. Reason:", reason);
        // Add reason to message display?
        setMessageText((prev) => prev + `\n\nSession ending: ${reason}`);
        // Delay stopSession slightly to allow message to display
        setTimeout(() => stopSession(), 2000); // 2 seconds delay
        return { success: true, message: "Session termination sequence initiated." };
    }

    // --- Game Check Functions & Progression Logic (Keep Original Logic) ---
     function handleWordProgression() {
        // Use confirmedSettings.phrases as the source of words for game length
        // Ensure phrases exists and is an array
        const currentPhrases = confirmedSettings?.phrases || [];
        const totalWords = currentPhrases.length;
        const isLastWord = currentWordIndex >= totalWords - 1;

        // Increment index only if not the last word
        const nextIndex = isLastWord ? -1 : currentWordIndex + 1; // Use -1 or similar to indicate end

        if (!isLastWord) {
            setCurrentWordIndex(nextIndex);
        } else {
            console.log("Last word processed. Signaling completion check.");
             // The AI will determine completion based on the isLastWord flag in the result
        }
        // Return state for AI to process
        return { isLastWord: isLastWord, nextWordIndex: nextIndex, totalWords: totalWords };
    }

    // Refactored handlers to use handleWordProgression
    function handleCorrectAnswer(functionName, args) {
         console.log(`${functionName} - Correct`, args);
         setCorrectAnswers(prev => prev + 1);
         const progressionState = handleWordProgression();
         return { success: true, isCorrect: true, ...args, ...progressionState };
    }
    function handleIncorrectAnswer(functionName, args) {
        console.log(`${functionName} - Incorrect`, args);
        const currentPhrases = confirmedSettings?.phrases || [];
        // Add to missed words if not already there
        if (currentWordIndex >= 0 && currentWordIndex < currentPhrases.length) {
            const currentPhrase = currentPhrases[currentWordIndex];
            // Ensure currentPhrase and its identifier exist before adding
            if (currentPhrase && (currentPhrase.chinese || currentPhrase.hanzi)) {
                setMissedWords(prev => {
                    const identifier = currentPhrase.chinese || currentPhrase.hanzi;
                    if (!prev.some(p => (p.chinese || p.hanzi) === identifier)) {
                        return [...prev, currentPhrase];
                    }
                    return prev; // Already missed
                });
            }
        }
        const progressionState = handleWordProgression();
        return { success: true, isCorrect: false, ...args, ...progressionState };
    }

    // Specific game check functions call the common handlers
    async function checkChineseGuessCorrect(args) { return handleCorrectAnswer('checkChineseGuessCorrect', args); }
    async function checkChineseGuessIncorrect(args) { return handleIncorrectAnswer('checkChineseGuessIncorrect', args); }
    async function checkEnglishMeaningCorrect(args) { return handleCorrectAnswer('checkEnglishMeaningCorrect', args); }
    async function checkEnglishMeaningIncorrect(args) { return handleIncorrectAnswer('checkEnglishMeaningIncorrect', args); }
    async function checkSentenceCorrect(args) { return handleCorrectAnswer('checkSentenceCorrect', args); }
    async function checkSentenceIncorrect(args) {
         // Sentence incorrect might have slightly different logic than just adding to missed words
         // For now, it uses the same incorrect handler
         console.log('checkSentenceIncorrect - Incorrect', args);
         // Basic checks that AI might find useful
         const containsWord = args.userSentence?.includes(args.targetWord);
         const hasBasicStructure = args.userSentence?.length > (args.targetWord?.length || 0) + 3; // Very basic check
         const progressionState = handleIncorrectAnswer('checkSentenceIncorrect', args); // Still progresses word index
         return { success: true, isCorrect: false, containsWord, hasBasicStructure, ...args, ...progressionState };
    }

    // --- Prompt Generation (Uses confirmedSettings state) ---
    function generatePrompt() {
        // Use confirmedSettings state which holds mode, level, topic, game details etc.
        if (confirmedSettings.mode !== 'talk' && !confirmedSettings.topicTitle && !confirmedSettings.gameType) {
            console.error("Prompt generation failed: No topic or game type confirmed.");
            return "System: Error - No content selected. Please use Settings (⚙️) to confirm selection.";
        }
        // Ensure phrases/conversation are populated if needed by the mode
        if ((confirmedSettings.mode === 'hsk' || confirmedSettings.mode === 'play') && !confirmedSettings.phrases?.length && !confirmedSettings.conversation?.length) {
            console.error("Prompt generation failed: No phrases or conversation data loaded for HSK/Play mode.");
            return "System: Error - No words/sentences selected for practice. Please use Settings (⚙️) to select a chunk.";
        }
    
        if (confirmedSettings.mode === 'hsk') {
            return generateHSKPrompt(confirmedSettings);
        } else if (confirmedSettings.mode === 'play') {
            return generatePlayModePrompt(confirmedSettings);
        } else { // 'talk' mode
            return generateTalkModePrompt();
        }
    }

    function generateTalkModePrompt() {
        const level = confirmedSettings.level;
        const englishPercent = level === 1 ? "90–100%" : level === 2 ? "80%" : level === 3 ? "60%" : "50%";
        const maxLevel = Math.min(level, 4); // Cap rules at HSK 4
      
        const promptLines = [];
      
        // === SYSTEM RULES ===
        promptLines.push(`IMPORTANT SYSTEM RULES (ENFORCE AT ALL TIMES):`);
        promptLines.push(`- You MUST use only vocabulary and grammar from HSK Level ${level} or below.`);
        if (level < 5) {
          promptLines.push(`- You MUST speak in ENGLISH for AT LEAST ${englishPercent} of your response.`);
          promptLines.push(`- DO NOT write full Chinese sentences unless the user already knows them.`);
          promptLines.push(`- NEVER teach Chinese words or grammar without explaining them clearly in ENGLISH first.`);
          promptLines.push(`- DO NOT drift into too much Chinese — always stay focused on gradual, supported learning.`);
        } else {
          promptLines.push(`- Use natural Chinese. English only if the user requests it.`);
        }
      
        promptLines.push(`\nThe user is at HSK Level ${level}. Strictly limit vocabulary and grammar to this level.`);
      
        // === USAGE GUIDANCE ===
        if (level < 5) {
          promptLines.push(`\nChinese vs English usage:`);
          promptLines.push(`Use English for at least ${englishPercent} of each message.`);
          promptLines.push(`Only introduce one new Chinese word or phrase at a time, with clear English support.`);
          promptLines.push(`Use yes/no or short Chinese questions ONLY if the user has seen them before.`);
          promptLines.push(`NEVER use full Chinese sentences unless repeating known phrases for practice.`);
        }
      
        // === TARGET VOCABULARY ===
        if (talkModeWords.length > 0 && level < 5) {
          const wordList = talkModeWords.map(w => w.chinese).join("、");
          promptLines.push(`\nTarget Vocabulary: Use these words as much as possible: ${wordList}。`);
          promptLines.push(`These are key for recognition, recall, and natural usage.`);
          promptLines.push(`Avoid introducing vocabulary outside this list unless absolutely necessary.`);
        }
      
        // === EXAMPLES ===
        const levelExamples = {
          1: [
            "Today, let's learn 去 — it means to go.",
            "Can you say: 我去学校 — I go to school?",
            "Do you know the word for friend? It's 朋友 (péngyou)!"
          ],
          2: [
            "Let's say: 我喜欢这个菜 — I like this dish.",
            "The word 飞机 means airplane — can you say: 我坐飞机?",
            "Try: 今天我去学校 — Today I go to school."
          ],
          3: [
            "Let's learn: A 比 B adjective. Like: 猫比狗小 — cats are smaller than dogs.",
            "你喜欢电影吗？means Do you like movies?",
            "Try saying: 今天我很忙 — Today I'm very busy."
          ],
          4: [
            "Let's learn 写完: 我写完作业了 — I finished my homework.",
            "你有没有一个目标？Goal? Like learning Chinese every day?",
            "说说你喜欢的电影？Tell me what movie you like."
          ]
        };
      
        if (levelExamples[maxLevel]) {
          promptLines.push(`\nExample Starter Lines:`);
          levelExamples[maxLevel].forEach(line => promptLines.push(`- ${line}`));
        }
      
        // === AI BEHAVIOR ===
        promptLines.push(`\nYou are 小球 (Xiǎoqiú), a warm, friendly, encouraging AI who chats daily with the user to help them practice spoken Mandarin.`);
        promptLines.push(`This is Talk Mode — a freeform conversation that feels natural, like talking to a buddy.`);
      
        promptLines.push(`
        Start casually: greet the user, ask about their day, feelings, or plans. Use memory (if available) only when relevant. Don't force topics.  
        Keep responses short (1–3 sentences). Always give the user room to reply. Ask simple, open-ended questions.  
        Encourage typing or speaking, but don't be too repetitive. Your tone should be:  
        - Friendly and informal  
        - Supportive of learning  
        - Curious but not nosy  
        - NEVER robotic
        
        Avoid loops, forced topics, or long Chinese sentences. Personalize only when it feels natural — never mention you have memory access.`);
      
        // === FINAL REMINDERS ===
        if (level < 5) {
          promptLines.push(`\nFINAL REMINDERS (ALWAYS ENFORCE):`);
          promptLines.push(`⚠️ Speak in ENGLISH for at least ${englishPercent} of each message.`);
          promptLines.push(`⚠️ Use ONLY HSK ${level} or lower vocabulary.`);
          promptLines.push(`⚠️ DO NOT write full Chinese sentences.`);
          promptLines.push(`⚠️ Introduce Chinese slowly, with short phrases and clear English explanations.`);
          promptLines.push(`⚠️ If in doubt — SIMPLIFY further.`);
        }
      
        // === USER CONTEXT ===
        if (user?.id && userMemory) {
          promptLines.push(`\nUser Context Information:\n${JSON.stringify(userMemory, null, 2)}`);
          promptLines.push(`Use this to personalize your tone and questions — but NEVER mention that you have memory data.`);
        } else if (user?.id && memoryLoading) {
          console.log("Memory still loading — using base prompt.");
        } else if (user?.id && memoryError) {
          console.warn("Memory fetch error — using base prompt:", memoryError);
        } else {
          console.log("No user ID — using default prompt.");
        }
      
        const finalPrompt = promptLines.join("\n");
        console.log("Final prompt is:\n", finalPrompt);
        return finalPrompt;
      }
      

    // Keep the detailed prompt generation logic (ensure it handles args correctly)
    function generateHSKPrompt({ level, topicTitle, englishTitle, phrases, conversation }) {
         let prompt = `You are 小球 (Xiǎoqiú), a friendly, helpful, and knowledgeable Chinese tutor for HSK Level ${level}. Your goal is to help the student practice and understand Chinese naturally. Encourage the student to speak more.\n` +
                      `Today's topic: ${topicTitle} (${englishTitle}).\n\n` +
                      `Start with: Hey, 小球 here! Let's practice ${topicTitle} for HSK ${level}.\n\n`; // Use italics

         if (phrases && phrases.length > 0) {
             prompt += `We'll cover these vocabulary words:\n`;
             phrases.forEach((p, i) => { prompt += `${i + 1}. ${p.chinese} (${p.pinyin}) - ${p.english}\n`; });
             prompt += `\nVocabulary Practice Flow:\n` +
                       `1. Introduce ONE word at a time, starting with ${phrases[0].chinese} (${phrases[0].pinyin}) meaning ${phrases[0].english}.\n` +
                       `2. Provide ONE clear, natural example sentence using the word.\n` +
                       `3. Ask the student to create their own sentence using the target word.\n` +
                       `   Example Request: Now, can you try making a sentence with ${phrases[0].chinese}?\n` +
                       `4. Listen carefully to the student's spoken response or read their typed response.\n` +
                       `5. Evaluate their sentence: Does it use the target word (${phrases[0].chinese}) correctly in context? Is the basic grammar understandable? Is it relevant?\n` +
                       `6. Apply the Correction Strategy & Question Handling guidelines below based on your evaluation.\n`+
                       `7. AFTER evaluating/correcting, introduce the NEXT word in the list and repeat from step 1.\n\n`;
         }

         if (conversation && conversation.length > 0) {
             prompt += `We'll also practice this dialogue:\n`;
             conversation.forEach((l, i) => { prompt += `${i + 1}. ${l.character}: ${l.chinese} (${l.pinyin}) - ${l.english}\n`; });
             prompt += `\nDialogue Practice Flow:\n` +
                       `1. Present ONE line of the dialogue AT A TIME, starting with line 1: ${conversation[0]?.character}: ${conversation[0]?.chinese}'\n` +
                       `2. Ask the student to explain what it means in their own words OR ask a simple question about its meaning/context.\n` +
                       `   Example Request: What do you think this line means? Or: Who is talking here?\n`+
                       `3. Listen carefully to the student's spoken response or read their typed response.\n` +
                       `4. Evaluate their understanding: Did they grasp the main idea? Are there misunderstandings?\n` +
                       `5. Apply the Correction Strategy & Question Handling guidelines below, providing clarification or the correct meaning as needed.\n`+
                       `6. AFTER evaluating/correcting, present the NEXT line of the dialogue and repeat from step 1.\n\n`;
         }

         prompt += `---
        Correction Strategy & Handling Student Questions (Apply AFTER evaluating the student's response OR when asked a question):\n` +
        `- Correct Attempt: Praise warmly! (Great!, Excellent!, Perfect sentence!). Then, move on to the next word/dialogue line.\n` +
        `- Close Attempt (Minor Error): Acknowledge effort positively (Almost!, Good try!). Gently point out the specific error & briefly explain/correct OR ask a guiding question (Remember the measure word here?, Try saying that again with the tones like this...). Give 1 retry. If still incorrect, provide the correct model and move on.\n` +
        `- Incorrect Attempt (Major Error/Off-Track): Stay encouraging! Don't just say 'wrong'. Guide by breaking it down (Let's look at ${phrases?.[0]?.chinese} again. How does it fit?) or provide a clear model (A better way is: [Correct sentence/explanation]). Check understanding briefly, then move on to the next item.\n` +
        `--- Strategies for Answering Student Questions ---\n` +
        `- Difference Qs (X vs Y): Acknowledge (Good question!). Explain key difference(s) simply (nuance, formality, usage). Provide simple contrasting examples. Keep concise (3-5 sentences max). Check understanding (Make sense?), then guide back to the next practice item.\n` +
        `- Other Grammar/Vocab Qs: If relevant, provide a clear, helpful explanation (3-4 sentences max). Use simple examples. Check understanding, guide back to the next practice item.\n` +
        `- Off-Topic Qs/Comments: Acknowledge briefly, politely redirect (That's interesting! Let's focus on our Chinese practice now.). Then proceed with the next practice item.\n` +
        `--- General Guidelines ---\n` +
        `- Conciseness: Keep standard turns concise (under 3 sentences). Allow slightly longer explanations for student questions (3-5 sentences).\n`+
        `- Encouragement: Be consistently patient and very encouraging.\n`+
        `- Pacing: Move on after 1-2 unsuccessful attempts on a single item.\n`+
        `- Student Focus: Prioritize getting the student to speak/type (voice and text).\n`+
         `- Completion: Once all words/sentences in the chunk are covered, conclude positively (e.g., Great work on that section!). If there are other chunks (e.g., dialogue after words), introduce the next section. If all selected content is finished, say something like "We've covered everything for ${topicTitle}! Well done!". You don't need to call endSession unless the user asks to stop.`;

        return prompt;
    }

    // Keep the detailed prompt generation logic (ensure it handles args correctly)
    function generatePlayModePrompt({ gameType, gameName, gameDesc, phrases }) {
        // Ensure phrases are available for the game
        if (!phrases || phrases.length === 0) {
            return `System: Error - Cannot start game ${gameName}. No words loaded for practice. Please select a different chunk in Settings.`;
        }

        let prompt = `You are 小球 (Xiǎoqiú), the fun and energetic host of the Chinese game ${gameName}! 🎮\n` +
                     `Game Goal: ${gameDesc}\n\n` +
                     `Start with: Hey there! I'm 小球! Ready to play ${gameName}? ${getGameInstructions(gameType)}\n\n`;

        prompt += `Today's words (${phrases.length} total):\n`;
        prompt += `\n---\nGame Flow & Rules:\n${getDetailedGameRules(gameType)}\n` +
                  `1. Present the first word/challenge based on the rules.\n` +
                  `2. Wait for the user's response (spoken or typed).\n`+
                  `3. As SOON as the user responds, IMMEDIATELY call the correct function (e.g., checkChineseGuessCorrect, checkSentenceIncorrect) with the user's answer and the correct details.\n`+
                  `4. The function result will contain 'isCorrect' (true/false) and 'isLastWord' (true/false).\n`+
                  `5. If isCorrect is true: Be ENTHUSIASTIC! 🎉 (Correct!, Yes!, Awesome!). Mention streaks after 3 correct in a row! Then, if isLastWord is FALSE, immediately present the next word/challenge based on the game rules.\n`+
                  `6. If isCorrect is false: Be gentle (Not quite!, Close!). Briefly state the correct answer (The answer is [correct answer]). Then, if isLastWord is FALSE, immediately present the next word/challenge based on the game rules.\n`+
                  `IMPORTANT Notes:\n`+
                  `- Function Calls are Key: Your primary job is to present the challenge and call the correct function immediately upon user response. The function handles scoring and progression logic.\n`+
                  `- Minimal Chat: Keep your turns very short - just present the challenge, or give brief feedback + next challenge, or handle the end-game review prompt.\n` +
                  `- No Extra Help: Do not provide hints or explanations unless it's part of the incorrect feedback (stating the correct answer).`;

        return prompt;
    }

    // Helper for game instructions/rules (Keep as original)
    function getGameInstructions(gameType) {
        switch (gameType) {
            case 'guess': return "I'll give the English, you say or type the Chinese!";
            case 'reverse': return "I'll say Chinese, you give the English meaning (say or type)!";
            case 'sentence-maker': return "I'll give a word, you make a sentence (say or type)!";
            default: return "Let's practice some Chinese!";
        }
    }
    function getDetailedGameRules(gameType) {
         switch (gameType) {
            case 'guess': return "- I present English meaning.\n- You provide Chinese response (spoken/typed).\n- NEVER surround the word with quotes like \"apple.\" or add periods.";
            case 'reverse': return "- I say the Chinese word.\n- You provide English meaning (spoken/typed).\n- NEVER surround the word with quotes like \"apple.\" or add periods.";
            case 'sentence-maker': return "- I state target Chinese word.\n- I give example sentence.\n- You create YOUR OWN sentence using the word (spoken/typed).\n- NEVER surround the word with quotes like \"apple.\" or add periods.";
            default: return "- Present words clearly.\n- Encourage practice.\n- Keep it fun!";
        }
    }


    // --- Send Client Events/Messages (Keep Original Implementations) ---
    function sendTextMessage(message) {
        if (!message || !message.trim()) {
             console.warn("Attempted to send empty text message."); return;
        }
        const event = {
            type: "conversation.item.create",
            event_id: crypto.randomUUID(),
            item: { type: "message", role: "user", content: [{ type: "input_text", text: message }] },
        };
        sendClientEvent(event);
        // Trigger AI response *after* sending user message
        sendClientEvent({ type: "response.create", event_id: crypto.randomUUID() });
    }

    function sendClientEvent(message) {
        if (dataChannel && dataChannel.readyState === "open") {
            try {
                // Ensure event_id exists, create if not
                message.event_id = message.event_id || crypto.randomUUID();
                const messageString = JSON.stringify(message);
                // console.log("SENDING EVENT:", messageString); // Uncomment for detailed debug
                dataChannel.send(messageString);
            } catch (error) {
                console.error("Error sending client event:", error, message);
            }
        } else {
            console.warn("Data channel not open, cannot send event:", message.type);
            // Optionally try to buffer or alert user? For now, just warn.
        }
    }

    // --- Input Handlers (Keep Original Implementations) ---
    const handlePttStart = (e) => {
        e.preventDefault(); // Prevent potential text selection on mobile
        if (!isSessionActive || !userAudioTrackRef.current || isTalking || isTextInputMode) return;
        // Clear any lingering stop timeout
        if (pttStopTimeoutRef.current) clearTimeout(pttStopTimeoutRef.current); pttStopTimeoutRef.current = null;

        console.log("PTT Start - Enabling Mic");
        try {
             userAudioTrackRef.current.enabled = true;
             setIsTalking(true);
        } catch (error) { console.error("Error enabling mic track:", error); }
    };
    const handlePttStop = (e) => {
        e.preventDefault();
        if (!isSessionActive || !userAudioTrackRef.current || !isTalking || isTextInputMode) return;

        console.log("PTT Stop triggered - Scheduling mic disable.");
        setIsTalking(false); // Update UI immediately

        // Debounce disabling the mic track slightly
        if (pttStopTimeoutRef.current) clearTimeout(pttStopTimeoutRef.current); // Clear existing timeout
        const delayMs = 300; // 300ms delay - adjust as needed
        pttStopTimeoutRef.current = setTimeout(() => {
            if (userAudioTrackRef.current) { // Check if track still exists
                 try {
                     console.log(`PTT Stop - Disabling mic after ${delayMs}ms`);
                     userAudioTrackRef.current.enabled = false;
                 }
                 catch (error) { console.error("Error disabling mic track:", error); }
            }
            pttStopTimeoutRef.current = null; // Clear ref after execution
        }, delayMs);
    };
    const handleTextInputChange = (e) => { setUserTextInput(e.target.value); };
    const handleTextInputKeyDown = (e) => {
        if (e.key === 'Enter' && userTextInput.trim()) {
            e.preventDefault(); // Prevent form submission if inside a form
            sendTextMessage(userTextInput.trim());
            setConversationHistory(prev => [...prev, { role: 'user', content: userTextInput.trim() }]);
            setUserTextInput(""); // Clear input after sending
        }
    };
    const toggleInputMode = () => {
        let textToSend = "";
        // If switching FROM text mode, send any pending input
        if (isTextInputMode && userTextInput.trim()) {
            textToSend = userTextInput.trim();
            setUserTextInput(""); // Clear input
        }

        // Interrupt AI speech if sending text via toggle
        if (textToSend && audioElement.current && !audioElement.current.paused) {
            audioElement.current.pause(); // Stop playback
            console.log("Interrupting AI speech due to text send on toggle.");
             // Maybe also call closeMouth?
             closeMouth();
        }
        // Send the text message if there was any
        if (textToSend) { sendTextMessage(textToSend); }


        const nextIsTextInputMode = !isTextInputMode;
        // Ensure mic is disabled when switching modes, unless PTT is active (handled by PTT)
        if (userAudioTrackRef.current) {
             console.log(`Switching to ${nextIsTextInputMode ? 'text' : 'voice'} mode. Mic track enabled: false`);
             userAudioTrackRef.current.enabled = false; // Mic always disabled unless PTT active
             if (nextIsTextInputMode) { // Clear PTT state if switching TO text
                 setIsTalking(false); // Ensure PTT visual state is off
                 if (pttStopTimeoutRef.current) clearTimeout(pttStopTimeoutRef.current); pttStopTimeoutRef.current = null;
             }
        }
        setIsTextInputMode(nextIsTextInputMode);
    };

    async function storeMemory(message) {
        if (confirmedSettings.mode === 'talk' && user?.id) {
          try {
            await fetch(`${process.env.REACT_APP_API_URL}/memory/store`, {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ 
                user_id: user.id, 
                message 
              }),
            });
            // No need to await the response if you don't need to do anything with it
          } catch (error) {
            console.error("Error storing memory:", error);
            // Handle error if needed, but don't block conversation
          }
        }
      }

    // --- Session Management (Start/Stop - Keep Original Logic, ensure checks use confirmedSettings) ---
    async function startSession(directSettings) {
        // Use directly passed settings or fall back to state
        const settingsToUse = directSettings || confirmedSettings;
        
        // Guard: Check if settings are confirmed (unless talk mode)
        if (mode === 'talk' && !settingsToUse.level) {
            setMessageText(t.selectLevelPrompt || "Please select your HSK level.");
            setIsSettingsOpen(true);
            return;
        }
        if ((mode === 'hsk' || mode === 'play') && !settingsToUse.topicTitle && !settingsToUse.gameType) {
            setMessageText(t.selectSettingsPrompt || t.welcomeMessage);
            setIsSettingsOpen(true);
            return;
        }
        // Guard: Check for necessary phrases/conversation data based on mode
        if ((settingsToUse.mode === 'hsk' || settingsToUse.mode === 'play') && !settingsToUse.phrases?.length && !settingsToUse.conversation?.length) {
            setMessageText(t.selectChunkPrompt || "No words/sentences selected. Please select a chunk in Settings (⚙️).");
            setIsSettingsOpen(true);
            return;
        }

        if (isSessionActive || peerConnection.current) {
            console.warn("Session start requested but already active or starting."); return;
        }
        console.log("Starting session...");
        setMessageText(t.connecting || t.connecting);
        stopSession(true); // Clear any potential remnants before starting

        try {
            const apiUrl = process.env.REACT_APP_API_URL;
            if (!apiUrl) throw new Error("API URL (REACT_APP_API_URL) is not configured.");

            // 1. Fetch Token
            const tokenRes = await fetch(`${apiUrl}/token`);
            if (!tokenRes.ok) throw new Error(`Token fetch failed: ${tokenRes.status}`);
            const tokenData = await tokenRes.json();
            const EPHEMERAL_KEY = tokenData?.client_secret?.value;
            if (!EPHEMERAL_KEY) throw new Error("Invalid token data received.");
            // console.log("Token fetched successfully."); // Debug

            // 2. Create Peer Connection
            const pc = new RTCPeerConnection({ iceServers: [{ urls: 'stun:stun.l.google.com:19302' }] });
            peerConnection.current = pc;
            // console.log("Peer connection created."); // Debug

            // 3. Setup Audio Element
            if (!audioElement.current) { // Create only if doesn't exist
                audioElement.current = document.createElement("audio");
                audioElement.current.autoplay = true;
                audioElement.current.muted = false; // Ensure not muted
                document.body.appendChild(audioElement.current);
                // console.log("Audio element created and added to body."); // Debug
            } else {
                 // console.log("Audio element already exists."); // Debug
                 audioElement.current.pause(); // Ensure it's paused before assigning new stream
                 audioElement.current.srcObject = null;
            }


             // 4. Add Peer Connection Event Listeners (Now handled by useEffect)

             // Handle incoming server tracks
            pc.ontrack = (event) => {
                console.log(`Track received: ${event.track.kind}`);
                if (event.track.kind === 'audio' && event.streams && event.streams[0]) {
                    console.log("Assigning server audio stream to audio element.");
                    serverAudioStreamRef.current = event.streams[0]; // Store ref to stream
                    audioElement.current.srcObject = event.streams[0];
                    // Attempt to play, catch errors
                    audioElement.current.play().catch(e => {
                        console.error("Server audio play failed:", e);
                         // Maybe update UI to inform user they might need to interact
                         setMessageText((prev) => prev + "\n(Browser might block audio initially. Click/tap needed?)");
                    });
                    event.track.onended = () => console.warn("Server audio track ended."); // Log when track ends
                } else {
                     console.log(`Ignoring track kind: ${event.track.kind}`);
                }
            };

            // 5. Create Data Channel
            // Ensure it's created before offer/answer exchange
            const dc = pc.createDataChannel("oai-events", { ordered: true });
            setDataChannel(dc); // State update triggers useEffect to add listeners
            console.log("Data channel created.");

            // 6. Get User Media (Microphone)
            let userStream;
            try {
                 userStream = await navigator.mediaDevices.getUserMedia({ audio: true });
                 const audioTrack = userStream.getAudioTracks()[0];
                 if (!audioTrack) throw new Error("No audio track found in user media stream.");
                 userAudioTrackRef.current = audioTrack; // Store ref to user track
                 pc.addTrack(audioTrack, userStream);
                 // IMPORTANT: Start with the user's mic track disabled for PTT
                 audioTrack.enabled = false;
                 console.log(`User microphone track added. Enabled: ${audioTrack.enabled}`);
            } catch (mediaError) {
                 console.error("getUserMedia error:", mediaError);
                 setMessageText(`Error accessing microphone: ${mediaError.message}. Please grant permission and reload.`);
                 // Cleanup partial connection
                 pc.close(); peerConnection.current = null;
                 if (audioElement.current) audioElement.current.remove(); audioElement.current = null;
                 setSplineFullyLoaded(true); // Allow spline interaction even if mic failed
                 throw new Error(`Microphone access denied or failed: ${mediaError.message}`);
            }

            // 7. Create Offer
            const offer = await pc.createOffer();
            await pc.setLocalDescription(offer);
            console.log("Local offer created and set.");

            // 8. Send Offer to Server (OpenAI endpoint)
            const sdpRes = await fetch("https://api.openai.com/v1/realtime?model=gpt-4o-realtime", {
                method: "POST",
                body: offer.sdp, // Send SDP directly
                headers: {
                    Authorization: `Bearer ${EPHEMERAL_KEY}`,
                    "Content-Type": "application/sdp", 
                },
            });

            if (!sdpRes.ok) {
                const errorText = await sdpRes.text(); // Get error details from response body
                throw new Error(`SDP exchange failed: ${sdpRes.status} - ${errorText}`);
            }

            // 9. Set Remote Answer
            const answerSdp = await sdpRes.text();
            await pc.setRemoteDescription({ type: "answer", sdp: answerSdp });
            console.log("Remote answer received and set. Connection negotiating.");

            // Message update will happen in handleChannelOpen once connected
            setMessageText(t.waitingForAi || "Waiting for AI...");
            // Start with empty conversation history
            setConversationHistory([]);

        } catch (error) {
            console.error("Session start process failed:", error);
            setMessageText(`Connection failed: ${error.message}`);
            stopSession(true); // Ensure cleanup on failure
            setSplineFullyLoaded(true); // Keep spline interactive
        }
    }

    function stopSession(isRestarting = false) {
        console.log(`Stopping session... Restarting: ${isRestarting}`);
         // Check if already stopped or stopping to prevent redundant calls
        if (!peerConnection.current && !isRestarting) {
            console.log("Stop session called but already inactive."); return;
        }

        // ---- Cleanup Sequence ----
        // 1. Stop animations and timers
        if (animationFrameRef.current) cancelAnimationFrame(animationFrameRef.current); animationFrameRef.current = null;
        if (silenceTimeoutRef.current) clearTimeout(silenceTimeoutRef.current); silenceTimeoutRef.current = null;
        if (pttStopTimeoutRef.current) clearTimeout(pttStopTimeoutRef.current); pttStopTimeoutRef.current = null;
        closeMouth(); // Ensure mouth animation stops

        // 2. Close audio context
        audioContextRef.current?.close().catch(e => console.warn("Error closing audio context:", e)); audioContextRef.current = null; analyserRef.current = null;

        // 3. Close data channel
        dataChannel?.close();
        // Note: Let the 'close' event listener handle setting dataChannel state to null

        // 4. Stop user media track
        userAudioTrackRef.current?.stop(); userAudioTrackRef.current = null;

        // 5. Close peer connection
        peerConnection.current?.close(); peerConnection.current = null;

        // 6. Cleanup audio element
        if (audioElement.current) {
             audioElement.current.pause();
             audioElement.current.srcObject = null; // Release stream reference
             // Optional: Remove element if created dynamically, or just reset src
             // audioElement.current.remove(); audioElement.current = null;
        }
        serverAudioStreamRef.current = null; // Clear ref to server stream

        // ---- Reset State ----
        setIsSessionActive(false);
        setIsTalking(false);
        // setDataChannel(null); // Handled by close event listener? Double check. Setting here is safer.
        setDataChannel(null);
        if (confirmedSettings.mode === 'talk' && user?.id && conversationHistory.length > 0) {
            fetch(`${process.env.REACT_APP_API_URL}/memory/store`, {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                user_id: user.id,
                message: `Conversation: ${JSON.stringify(conversationHistory, null, 2)}`
              }),
            }).then(() => {
              console.log("Conversation history sent");
            }).catch(err => {
              console.error("Failed to store conversation history:", err);
            });
            console.log("message is", JSON.stringify(conversationHistory, null, 2))
        }

        console.log("Session stopped and resources released.");
    }

    // --- Spline Load (Keep Original) ---
    function handleSplineLoad(spline) {
        console.log("Spline scene loaded.");
        setSplineObj(spline);
        setSplineFullyLoaded(true);
        // Message state is handled by connection status or initial state now
    }

    // --- Settings Panel Rendering Logic (Revised with Chunk Selection) ---
    const renderSettingsPanel = () => {
        if (!isSettingsOpen) return null;
        
        // Define current step based on selections
        let currentStep = 1;
        
        // For play mode
        if (mode === 'play') {
            if (selectedGameTypeInfo && selectedLevel && selectedTopic && selectedChunkData) {
                currentStep = 5; // Ready to confirm
            } else if (selectedGameTypeInfo && selectedLevel && selectedTopic) {
                currentStep = 4; // Select chunk
            } else if (selectedGameTypeInfo && selectedLevel) {
                currentStep = 3; // Select topic
            } else if (selectedGameTypeInfo) {
                currentStep = 2; // Select level
            } else {
                currentStep = 1; // Select game
            }
        } 
        // For HSK mode
        else if (mode === 'hsk') {
            if (selectedLevel && selectedTopic && selectedChunkData) {
                currentStep = 4; // Ready to confirm
            } else if (selectedLevel && selectedTopic) {
                currentStep = 3; // Select chunk
            } else if (selectedLevel) {
                currentStep = 2; // Select topic
            } else {
                currentStep = 1; // Select level
            }
        }
        // For talk mode
        else if (mode === 'talk') {
            if (selectedLevel) {
                currentStep = 2; // Ready to confirm
            } else {
                currentStep = 1; // Select level
            }
        }
    
        // Handlers for temporary selections in panel
        const handleGameSelect = (gameInfo) => {
            setSelectedGameTypeInfo(gameInfo);
            setSelectedLevel(null); 
            setSelectedTopic(null); 
            setSelectedChunkData(null); 
            setLessons([]);
            setSettingsError(null);
        };
    
        const handleLevelSelect = (level) => {
            setSelectedLevel(level);
            setSelectedTopic(null); 
            setSelectedChunkData(null); 
            setLessons([]); 
            setSettingsError(null);
            fetchLessons(level);
        };
    
        const handleTopicSelect = (topic) => {
            setSelectedTopic(topic);
            setSelectedChunkData(null);
            setChunkSelectionType('word');
            setSettingsError(null);
        };
    
        const handleChunkSelect = (type, chunk, index) => {
            setSelectedChunkData({ type, chunk, index });
            setSettingsError(null);
        };
    
        // Handler to go back one step
        const handleBackStep = () => {
            if (mode === 'play') {
                if (currentStep === 5 || currentStep === 4) {
                    setSelectedChunkData(null);
                } else if (currentStep === 3) {
                    setSelectedTopic(null);
                    setLessons([]);
                } else if (currentStep === 2) {
                    setSelectedLevel(null);
                } else if (currentStep === 1) {
                    setSelectedGameTypeInfo(null);
                }
            } else if (mode === 'hsk') {
                if (currentStep === 4 || currentStep === 3) {
                    setSelectedChunkData(null);
                } else if (currentStep === 2) {
                    setSelectedTopic(null);
                    setLessons([]);
                } else if (currentStep === 1) {
                    setSelectedLevel(null);
                }
            } else if (mode === 'talk' && currentStep === 2) {
                setSelectedLevel(null);
            }
        };
    
        // Handler to confirm ALL selections and update confirmedSettings
        const handleConfirmSettings = () => {
            // Prevent multiple rapid clicks
            if (isStartingSession) return;
            
            let finalSettings = {};
            let isValid = false;
            let errorMsg = "";
            
            if (mode === 'hsk') {
                if (selectedLevel && selectedTopic && selectedChunkData) {
                    finalSettings = {
                        mode: 'hsk', 
                        level: selectedLevel, 
                        topicTitle: selectedTopic.topicTitle, 
                        englishTitle: selectedTopic.englishTitle,
                        phrases: selectedChunkData.type === 'word' ? selectedChunkData.chunk : [],
                        conversation: selectedChunkData.type === 'sentence' ? selectedChunkData.chunk : [],
                        gameType: null, 
                        gameName: null, 
                        gameDesc: null,
                    };
                    isValid = true;
                } else { 
                    errorMsg = t.selectLevelTopicChunkPrompt || "Please select Level, Topic, and a Word/Sentence Chunk."; 
                }
            } else if (mode === 'play') {
                if (selectedGameTypeInfo && selectedLevel && selectedTopic && selectedChunkData) {
                    finalSettings = {
                        mode: 'play', 
                        level: selectedLevel, 
                        topicTitle: selectedTopic.topicTitle, 
                        englishTitle: selectedTopic.englishTitle,
                        phrases: selectedChunkData.type === 'word' ? selectedChunkData.chunk : selectedChunkData.chunk,
                        conversation: [],
                        gameType: selectedGameTypeInfo.key, 
                        gameName: selectedGameTypeInfo.name, 
                        gameDesc: selectedGameTypeInfo.desc,
                    };
                    isValid = true;
                } else { 
                    errorMsg = t.selectGameLevelTopicChunkPrompt || "Please select Game Type, Level, Topic, and a Word/Sentence Chunk."; 
                }
            } else if (mode === 'talk') {
                if (!selectedLevel) {
                    errorMsg = t.selectLevelPrompt || "Please select your HSK level.";
                } else {
                    finalSettings = {
                        mode: 'talk',
                        level: selectedLevel,
                        topicTitle: null,
                        englishTitle: null,
                        phrases: [],
                        conversation: [],
                        gameType: null,
                        gameName: null,
                        gameDesc: null
                    };
                    isValid = true;
                }
            }
            
            if (!isValid) {
                setSettingsError(errorMsg);
                return;
            }
        
            // Set loading state to prevent double clicks
            setIsStartingSession(true);
            
            // Close settings panel first
            setIsSettingsOpen(false);
            
            // Update confirmed settings
            setConfirmedSettings(finalSettings);
            
            // Reset panel's temporary state
            setSelectedGameTypeInfo(null);
            setSelectedLevel(null);
            setSelectedTopic(null); 
            setSelectedChunkData(null);
            setLessons([]);
            setSettingsError(null);
        
            // Update user message
            setMessageText(t.connecting || "Connecting...");
            
            // Use setTimeout to ensure state updates have completed
            setTimeout(() => {
                startSession(finalSettings);
                setIsStartingSession(false);
            }, 50);
        };
    
         // Define Play Options structure locally
         const playOptions = [
           { key: 'guess', name: t.guessTheWord || "Guess Word", desc: t.guessTheWordDesc || "EN->CN", icon: creepyIcon },
           { key: 'reverse', name: t.guessTheMeaning || "Guess Meaning", desc: t.guessTheMeaningDesc || "CN->EN", icon: happyIcon },
           { key: 'sentence-maker', name: t.createSentences || "Sentence", desc: t.createSentencesDesc || "Make sentence", icon: naturalIcon }
         ];
    
        // Calculate chunks to display based on temporary selection
        const wordChunks = selectedTopic ? createWordChunks(selectedTopic.newWords) : [];
        const sentenceChunks = selectedTopic ? createSentenceChunks(selectedTopic.conversation) : [];
    
        // Determine if confirm button should be enabled
        const enableConfirm = (mode === 'talk' && selectedLevel) ||
                              (mode === 'hsk' && selectedLevel && selectedTopic && selectedChunkData) ||
                              (mode === 'play' && selectedGameTypeInfo && selectedLevel && selectedTopic && selectedChunkData);
    
        return (
            <div className="settings-panel-overlay">
                <div className="settings-panel">
                    {/* Panel Header with back button */}
                    <div className="settings-panel-header">
                        <h3 className="settings-panel-title">
                            {mode === 'play' && "Game Setup"}
                            {mode === 'hsk' && "HSK Practice Setup"}
                            {mode === 'talk' && "Talk Mode Setup"}
                        </h3>
                    </div>
    
                    {/* Error message display */}
                    {settingsError && (
                        <div className="settings-error-message">{settingsError}</div>
                    )}
    
                    {/* Step 1: Select Game Type (Play Mode Only) */}
                    {mode === 'play' && currentStep === 1 && (
                        <div className="settings-row">
                            <div className="settings-options-grid games">
                                {playOptions.map((opt) => (
                                    <button key={opt.key}
                                        className={`settings-button game-btn play-${opt.key}`}
                                        onClick={() => handleGameSelect(opt)}>
                                        <img src={opt.icon} alt={opt.name} className="game-icon-small"/>
                                        <span className="game-name">{opt.name}</span>
                                        <span className="game-desc">{opt.desc}</span>
                                    </button>
                                ))}
                            </div>
                        </div>
                    )}
    
                    {/* Step: Select HSK Level */}
                    {((mode === 'play' && currentStep === 2) || 
                      (mode === 'hsk' && currentStep === 1) || 
                      (mode === 'talk' && currentStep === 1)) && (
                        <div className="settings-row">
                            <div className="settings-options-grid levels">
                                {[1, 2, 3, 4, 5, 6].map(lvl => (
                                    <button key={lvl}
                                        className={`settings-button level-btn hsk${lvl}`}
                                        onClick={() => handleLevelSelect(lvl)}>
                                        HSK {lvl}
                                    </button>
                                ))}
                            </div>
                        </div>
                    )}
    
                    {/* Step: Select Topic */}
                    {((mode === 'play' && currentStep === 3) || (mode === 'hsk' && currentStep === 2)) && (
                        <div className="settings-row topics-row">
                            {loadingSettings && (
                                <div className="settings-loading">{t.loadingTopics || "Loading topics..."}</div>
                            )}
                            {!loadingSettings && lessons.length > 0 && (
                                <div className="settings-options-grid topics">
                                    {lessons.map(lesson => (
                                        <button key={lesson._id}
                                            className={`settings-button topic-btn`}
                                            onClick={() => handleTopicSelect(lesson)}>
                                            {lesson.icon || '📝'} {lesson.topicTitle}
                                            <span className="topic-subtitle">{lesson.englishTitle}</span>
                                        </button>
                                    ))}
                                </div>
                            )}
                            {!loadingSettings && lessons.length === 0 && !settingsError && (
                                <p className="no-topics-message">{t.noTopicsFound || "No topics found for this level."}</p>
                            )}
                        </div>
                    )}
    
                    {/* Step: Select Chunk */}
                    {((mode === 'play' && currentStep === 4) || (mode === 'hsk' && currentStep === 3)) && (
                        <div className="settings-row">
                            {/* Chunk Type Toggle Buttons */}
                            <div className="chunk-type-toggle">
                                <button
                                    className={`chunk-toggle-button ${chunkSelectionType === 'word' ? 'active' : ''}`}
                                    onClick={() => {
                                        if (chunkSelectionType !== 'word') {
                                            setChunkSelectionType('word');
                                            setSelectedChunkData(null);
                                        }
                                    }}
                                    disabled={wordChunks.length === 0}>
                                    {t.wordChunks || "Words"}
                                </button>
                                <button
                                    className={`chunk-toggle-button ${chunkSelectionType === 'sentence' ? 'active' : ''}`}
                                    onClick={() => {
                                        if (chunkSelectionType !== 'sentence') {
                                            setChunkSelectionType('sentence');
                                            setSelectedChunkData(null);
                                        }
                                    }}
                                    disabled={sentenceChunks.length === 0}>
                                    {t.sentenceChunks || "Sentences"}
                                </button>
                            </div>
    
                            {chunkSelectionType === 'word' && (
                                <div className="settings-options-grid chunks word-chunks-grid">
                                    {wordChunks.length > 0 ? (
                                        wordChunks.map((chunk, index) => {
                                            const isValidChunk = chunk && chunk.length > 0 && chunk.every(w => w && (w.chinese || w.hanzi));
                                            if (!isValidChunk) return null;
                                            const buttonText = chunk.map(w => w.chinese || w.hanzi).slice(0, 4).join(' / ') + (chunk.length > 4 ? '...' : '');
                                            const wordIndices = `Words ${index * 5 + 1}–${Math.min((index + 1) * 5, selectedTopic.newWords.length)}`;
                                            return (
                                                <button
                                                    key={`word-chunk-${index}`}
                                                    className={`settings-button chunk-btn word-chunk`}
                                                    onClick={() => handleChunkSelect('word', chunk, index)}
                                                    title={chunk.map(w => w.chinese || w.hanzi).join(' / ')}>
                                                    {buttonText}
                                                    <span className="chunk-subtitle">{wordIndices}</span>
                                                </button>
                                            );
                                        })
                                    ) : (
                                        <p className="no-topics-message">{t.noWordChunks || "No word chunks available."}</p>
                                    )}
                                </div>
                            )}
    
                            {chunkSelectionType === 'sentence' && (
                                <div className="settings-options-grid chunks sentence-chunks-grid">
                                    {sentenceChunks.length > 0 ? (
                                        sentenceChunks.map((chunk, index) => {
                                            const isValidChunk = chunk && chunk.length > 0 && chunk.every(s => s && (s.chinese || s.text));
                                            if (!isValidChunk) return null;
                                            const buttonText = chunk[0]?.chinese || chunk[0]?.text || 'Sentence...';
                                            const sentenceIndices = `Sentences ${index * 4 + 1}–${Math.min((index + 1) * 4, selectedTopic.conversation.length)}`;
                                            return (
                                                <button
                                                    key={`sentence-chunk-${index}`}
                                                    className={`settings-button chunk-btn sentence-chunk`}
                                                    onClick={() => handleChunkSelect('sentence', chunk, index)}
                                                    title={chunk.map(s => s.chinese || s.text).join('\n')}>
                                                    {buttonText.length > 50 ? buttonText.substring(0, 47) + '...' : buttonText}
                                                    <span className="chunk-subtitle">{sentenceIndices}</span>
                                                </button>
                                            );
                                        })
                                    ) : (
                                        <p className="no-topics-message">{t.noSentenceChunks || "No sentence chunks available."}</p>
                                    )}
                                </div>
                            )}
    
                            {wordChunks.length === 0 && sentenceChunks.length === 0 && (
                                <p className="no-topics-message">{t.noChunksFound || "No content chunks found for this topic."}</p>
                            )}
                        </div>
                    )}
    
                    {/* Final Step: Confirmation Screen */}
                    {((mode === 'play' && currentStep === 5) || 
                      (mode === 'hsk' && currentStep === 4) || 
                      (mode === 'talk' && currentStep === 2)) && (
                        <div className="settings-row confirmation-row">
                            <div className="settings-summary">
                                {mode === 'play' && (
                                    <>
                                        <p><strong>Game:</strong> {selectedGameTypeInfo.name}</p>
                                        <p><strong>Level:</strong> HSK {selectedLevel}</p>
                                        <p><strong>Topic:</strong> {selectedTopic.topicTitle}</p>
                                    </>
                                )}
                                {mode === 'hsk' && (
                                    <>
                                        <p><strong>Level:</strong> HSK {selectedLevel}</p>
                                        <p><strong>Topic:</strong> {selectedTopic.topicTitle}</p>
                                    </>
                                )}
                                {mode === 'talk' && (
                                    <>
                                        <p><strong>Talk Mode:</strong> HSK {selectedLevel}</p>
                                    </>
                                )}
                            </div>
                        </div>
                    )}
    
                    {/* Confirm Button */}
                    <button 
                        className="settings-confirm-button" 
                        onClick={handleConfirmSettings} 
                        disabled={!enableConfirm}>
                        {((mode === 'play' && currentStep === 5) || 
                         (mode === 'hsk' && currentStep === 4) || 
                         (mode === 'talk' && currentStep === 2)) 
                            ? (t.startSession || "Start Session") 
                            : (t.continue || "Continue")}
                    </button>
                </div>
            </div>
        );
    };
    // --- Get Page Title (Keep as original) ---
    const getPageTitle = () => { if (confirmedSettings.topicTitle) return confirmedSettings.topicTitle; if (confirmedSettings.gameName) return confirmedSettings.gameName; if (mode === 'hsk') return t.hskPractice || "HSK Practice"; if (mode === 'play') return t.playMode || "Play Mode"; if (mode === 'talk') return t.talkMode || "Talk Mode"; return t.conversationPractice || "Conversation"; };

    const handleSendTextClick = () => {
        if (userTextInput.trim() && isSessionActive) {
            sendTextMessage(userTextInput.trim());
            setConversationHistory(prev => [...prev, { role: 'user', content: userTextInput.trim() }]);
            setUserTextInput(""); // Clear input after sending
        }
    };

    console.log("started", convoStarted)
    // --- Main Return JSX (Modified to use chat interface style) ---
    return (
        <div className="conversation-container">
            {/* Loading Overlay */}
            {!splineFullyLoaded && (
                <div className="loading-overlay">
                    <div className="loading-spinner"></div>
                    <p>{t.loadingAvatar || "Loading Avatar..."}</p>
                </div>
            )}

            {/* Back Button */}
             <button className="main-back-button conv-back-button" onClick={() => { stopSession(); navigate(-1); }}> {/* Ensure stopSession is called */}
                <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M19 12H5M12 19l-7-7 7-7"/></svg>
                <span>{t.back || "Back"}</span>
            </button>

            {/* Settings Panel */}
            {renderSettingsPanel()}

            {/* Top Controls */}
            <div className="session-controls">
                {/* Input Mode Toggle Button */}
                <button
                    className="input-mode-toggle-button"
                    onClick={toggleInputMode}
                    title={isTextInputMode ? (t.switchToVoice || "Switch to Voice Input") : (t.switchToText || "Switch to Text Input")}
                    // Enable only if session active OR settings are confirmed sufficiently for the mode
                    disabled={!isSessionActive && (!confirmedSettings.topicTitle && !confirmedSettings.gameType && mode !== 'talk')}
                >
                    {isTextInputMode ? <MicIcon /> : <KeyboardIcon />}
                </button>
            </div>


            {/* Main Content Wrapper */}
            <div className="content-wrapper">

                 {/* Header */}
                <div className="conversation-header">
                    <h2>{getPageTitle()}</h2>
                    {confirmedSettings.level && <span className="hsk-level-indicator">HSK {confirmedSettings.level}</span>}
                </div>
                {/* Welcome */}
                {convoStarted === false ? (
                    <>
                    <div className="profile-area">
                        <div className="avatar">
                            <img src={yeyIcon} alt="yey" style={{width: "80px", height: "80px"}} />
                        </div>
                        <h1 className="greeting">Hello, {user?.name || 'Student'}</h1>
                        <p className="subtext">{messageText || 'How should we practice Mandarin today?'}</p>
                    </div>
                    </> 
                ) : (
                    /* Messages Container - Chat Style Interface */
                    <div className="messages-container" ref={messagesContainerRef}>
                        {conversationHistory.map((message, index) => (
                            <div 
                                key={index} 
                                className={`message ${message.role === 'user' ? 'user-message' : 'bot-message'}`}
                            >
                                {message.role === 'assistant' && (
                                    <img src={yeyIcon} alt="yey" style={{width: "45px", height: "45px", marginRight: "5px"}} />
                                )}
                                <div className="message-bubble-convo">
                                    {message.content.split('\n').map((line, i) => (
                                        <React.Fragment key={i}>
                                            {line}
                                            {i !== message.content.split('\n').length - 1 && <br />}
                                        </React.Fragment>
                                    ))}
                                </div>
                            </div>
                        ))}
                        
                        {/* In-progress message with streaming text */}
                        {messageText && isSessionActive && (
                            <div className="message bot-message">
                                <img src={yeyIcon} alt="yey" style={{width: "45px", height: "45px", marginRight: "5px"}} />
                                <div className="message-bubble-convo">
                                    {messageText.split('\n').map((line, i) => (
                                        <React.Fragment key={i}>
                                            {line}
                                            {i !== messageText.split('\n').length - 1 && <br />}
                                        </React.Fragment>
                                    ))}
                                </div>
                            </div>
                        )}
                    </div>
                )}

                {/* Input Area (Bottom) */}
                <div className="button-group">
                    <div className="input-area">
                        {isTextInputMode ? (
                            <div className="text-input-wrapper"> {/* New Wrapper */}
                                <input
                                    ref={textInputRef}
                                    type="text"
                                    className="text-input-field"
                                    placeholder={t.typeMessage || "Type your message..."}
                                    value={userTextInput}
                                    onChange={handleTextInputChange}
                                    onKeyDown={handleTextInputKeyDown}
                                    disabled={!isSessionActive}
                                />
                                <button
                                    className="send-text-button"
                                    onClick={handleSendTextClick}
                                    disabled={!isSessionActive || !userTextInput.trim()} // Disable if inactive or input empty
                                    title={t.sendMessage || "Send Message"}
                                >
                                    <SendIcon />
                                </button>
                            </div>
                        ) : (
                            <button
                                className={`ptt-button ${isTalking ? 'active' : ''}`}
                                onMouseDown={handlePttStart}
                                onMouseUp={handlePttStop}
                                onMouseLeave={handlePttStop}
                                onTouchStart={handlePttStart}
                                onTouchEnd={handlePttStop}
                                disabled={!isSessionActive}
                            >
                                <MicIcon />
                                {isTalking ? (t.listening || "Listening...") : (t.holdToTalk || "Hold to Talk")}
                            </button>
                        )}
                    </div>
                </div>
            </div>
        </div>
    );
}

export default ConversationPage;