import React, { useState, useRef, useEffect, useCallback } from 'react';
import { UploadIcon } from './Icons';
import { playSound } from '../utils/sound';

interface CameraScannerProps {
  onCapture: (file: File) => void;
  onClose: () => void;
}

const dataURLtoFile = (dataurl: string, filename: string): File => {
  const arr = dataurl.split(',');
  const mime = arr[0].match(/:(.*?);/)?.[1] || 'image/jpeg';
  const bstr = atob(arr[1]);
  let n = bstr.length;
  const u8arr = new Uint8Array(n);
  while (n--) {
    u8arr[n] = bstr.charCodeAt(n);
  }
  return new File([u8arr], filename, { type: mime });
};

export const CameraScanner: React.FC<CameraScannerProps> = ({ onCapture, onClose }) => {
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const [stream, setStream] = useState<MediaStream | null>(null);
  const [capturedImage, setCapturedImage] = useState<string | null>(null);
  const [capturedFile, setCapturedFile] = useState<File | null>(null);
  const [error, setError] = useState<string | null>(null);

  const [isMobile] = useState(() => /Mobi|Android/i.test(navigator.userAgent));
  type ScannerState = 'idle' | 'scanning' | 'preview';
  const [state, setState] = useState<ScannerState>('idle');

  const stopCamera = useCallback(() => {
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((track) => track.stop());
      streamRef.current = null;
      setStream(null);
    }
  }, []);

  const startCamera = useCallback(async () => {
    setError(null);
    try {
      const mediaStream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: 'environment' },
      });
      streamRef.current = mediaStream;
      setStream(mediaStream);
      if (videoRef.current) {
        videoRef.current.srcObject = mediaStream;
      }
      setState('scanning');
    } catch (err) {
      console.error('Error accessing camera:', err);
      setError('Could not access the camera. Please verify camera permissions or browse an image file.');
      setState('idle');
    }
  }, []);

  useEffect(() => {
    if (isMobile) {
      startCamera();
    }
    return () => {
      stopCamera();
      if (capturedImage && capturedImage.startsWith('blob:')) {
        URL.revokeObjectURL(capturedImage);
      }
    };
  }, [isMobile, startCamera, stopCamera]);

  const handleCapture = () => {
    if (videoRef.current && canvasRef.current) {
      const video = videoRef.current;
      const canvas = canvasRef.current;
      canvas.width = video.videoWidth;
      canvas.height = video.videoHeight;
      const context = canvas.getContext('2d');
      if (context) {
        playSound('click');
        context.drawImage(video, 0, 0, video.videoWidth, video.videoHeight);
        const dataUrl = canvas.toDataURL('image/jpeg', 0.92);
        setCapturedImage(dataUrl);
        setCapturedFile(null);
        setState('preview');
        stopCamera();
      }
    }
  };

  const handleRetake = () => {
    playSound('click');
    if (capturedImage && capturedImage.startsWith('blob:')) {
      URL.revokeObjectURL(capturedImage);
    }
    setCapturedImage(null);
    setCapturedFile(null);
    if (isMobile) {
      startCamera();
    } else {
      setState('idle');
    }
  };

  const handleUsePhoto = () => {
    let fileToUse: File | null = capturedFile;
    if (!fileToUse && capturedImage) {
      fileToUse = dataURLtoFile(capturedImage, `scan-${Date.now()}.jpg`);
    }
    if (fileToUse) {
      playSound('upload');
      stopCamera();
      onCapture(fileToUse);
      onClose();
    }
  };

  const handleFileDrop = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    const file = e.dataTransfer.files?.[0];
    if (file && file.type.startsWith('image/')) {
      playSound('upload');
      setCapturedFile(file);
      setCapturedImage(URL.createObjectURL(file));
      setState('preview');
    }
  };

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file && file.type.startsWith('image/')) {
      playSound('upload');
      setCapturedFile(file);
      setCapturedImage(URL.createObjectURL(file));
      setState('preview');
    }
  };

  const handleClose = () => {
    playSound('click');
    stopCamera();
    onClose();
  };

  const renderContent = () => {
    switch (state) {
      case 'scanning':
        return (
          <div className="relative w-full flex items-center justify-center">
            <video
              ref={videoRef}
              autoPlay
              playsInline
              className="w-full h-auto max-h-[58vh] rounded-2xl border border-purple-500/30 object-contain"
            />
            <div className="absolute bottom-4 left-1/2 -translate-x-1/2 text-center pointer-events-none px-4 w-full max-w-sm">
              <p className="text-xs sm:text-sm font-medium text-purple-100 px-3.5 py-2 rounded-full bg-[#090414]/85 border border-purple-400/35 backdrop-blur-md">
                Align answer sheet within frame &amp; hold steady
              </p>
            </div>
          </div>
        );
      case 'preview':
        return (
          <img
            src={capturedImage!}
            alt="Captured preview"
            className="w-full h-auto max-h-[58vh] rounded-2xl border border-purple-500/30 object-contain"
          />
        );
      case 'idle':
      default:
        return (
          <div
            onDragOver={(e) => e.preventDefault()}
            onDrop={handleFileDrop}
            className="w-full flex flex-col items-center justify-center p-6 sm:p-10 text-center bg-[#0c061c]/80 rounded-2xl border-2 border-dashed border-purple-500/35"
          >
            <div className="w-14 h-14 rounded-2xl bg-purple-950 border border-purple-400/35 flex items-center justify-center text-purple-300 mb-4">
              <UploadIcon className="w-7 h-7" />
            </div>
            <h3 className="text-lg font-bold text-white glow-text">Optical Sheet Scanner</h3>
            <p className="text-xs sm:text-sm text-purple-200/70 max-w-sm mt-1.5 mb-5">
              Drag &amp; drop a high-resolution sheet scan here, browse an image, or activate your device camera.
            </p>
            <input
              type="file"
              id="desktop-scanner-upload"
              className="sr-only"
              accept="image/*"
              onChange={handleFileSelect}
            />
            <label
              htmlFor="desktop-scanner-upload"
              className="px-5 py-2.5 rounded-full bg-purple-600/25 border border-purple-400/45 text-xs font-semibold text-white cursor-pointer hover:bg-purple-600/45 transition min-h-[42px] inline-flex items-center"
            >
              Browse Image File...
            </label>
          </div>
        );
    }
  };

  return (
    <div
      className="fixed inset-0 bg-black/80 backdrop-blur-xl z-50 flex items-center justify-center p-3 sm:p-4 animate-fade-in overflow-y-auto"
      aria-modal="true"
      role="dialog"
      onClick={handleClose}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="liquid-glass border-glow border-glow-active specular-beam w-full max-w-2xl flex flex-col overflow-hidden text-white rounded-3xl my-auto"
      >
        <header className="px-4 sm:px-6 py-4 border-b border-purple-500/20 flex justify-between items-center">
          <div>
            <h2 className="text-base sm:text-lg font-bold shimmer-text">Scan Document</h2>
            <p className="text-[11px] font-mono text-purple-300/60">GRADERLABS OPTICAL CAPTURE</p>
          </div>
          <button
            type="button"
            onClick={handleClose}
            className="w-9 h-9 rounded-full bg-purple-950/70 border border-purple-500/30 flex items-center justify-center text-purple-300 hover:text-white text-lg"
            aria-label="Close scanner"
          >
            &times;
          </button>
        </header>

        <div className="p-4 flex-grow flex items-center justify-center relative bg-[#05020b] min-h-[38vh]">
          {error ? (
            <div className="text-center text-rose-300 p-6 text-sm max-w-md">{error}</div>
          ) : (
            renderContent()
          )}
          <canvas ref={canvasRef} className="hidden" />
        </div>

        <footer className="px-4 sm:px-6 py-4 border-t border-purple-500/20 flex justify-center items-center gap-3 bg-[#090514]/80">
          {state === 'preview' ? (
            <>
              <button
                type="button"
                onClick={handleRetake}
                className="flex-1 py-3 px-4 rounded-xl border border-purple-500/35 bg-[#140a29] text-xs sm:text-sm font-semibold text-purple-100 hover:bg-purple-900/40 min-h-[44px]"
              >
                Retake
              </button>
              <button
                type="button"
                onClick={handleUsePhoto}
                className="flex-1 btn-quantix py-3 px-4 rounded-xl text-xs sm:text-sm font-semibold text-white min-h-[44px]"
              >
                Mount Sheet
              </button>
            </>
          ) : state === 'scanning' ? (
            <button
              type="button"
              onClick={handleCapture}
              disabled={!stream}
              aria-label="Capture photo"
              className="w-16 h-16 rounded-full bg-white border-4 border-purple-500 shadow-[0_0_24px_rgba(168,85,247,0.8)] hover:scale-105 active:scale-95 transition-all disabled:opacity-50"
            />
          ) : (
            <button
              type="button"
              onClick={startCamera}
              className="w-full btn-quantix py-3 px-4 rounded-xl text-xs sm:text-sm font-semibold text-white min-h-[44px]"
            >
              Activate Device Camera
            </button>
          )}
        </footer>
      </div>
    </div>
  );
};
