using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.IO;
using System.IO.Pipes;
using System.Runtime.InteropServices;
using System.Text;
using System.Threading;

namespace ComboCut.WasapiCapture
{
    internal enum EDataFlow
    {
        eRender = 0,
        eCapture = 1,
        eAll = 2
    }

    internal enum ERole
    {
        eConsole = 0,
        eMultimedia = 1,
        eCommunications = 2
    }

    internal enum AUDCLNT_SHAREMODE
    {
        AUDCLNT_SHAREMODE_SHARED = 0,
        AUDCLNT_SHAREMODE_EXCLUSIVE = 1
    }

    [StructLayout(LayoutKind.Sequential)]
    internal struct PROPERTYKEY
    {
        public Guid fmtid;
        public uint pid;
    }

    [StructLayout(LayoutKind.Sequential)]
    internal struct PROPVARIANT
    {
        public ushort vt;
        public ushort wReserved1;
        public ushort wReserved2;
        public ushort wReserved3;
        public IntPtr p;
        public int p2;
    }

    [StructLayout(LayoutKind.Sequential, Pack = 1)]
    internal struct WAVEFORMATEX
    {
        public ushort wFormatTag;
        public ushort nChannels;
        public uint nSamplesPerSec;
        public uint nAvgBytesPerSec;
        public ushort nBlockAlign;
        public ushort wBitsPerSample;
        public ushort cbSize;
    }

    [StructLayout(LayoutKind.Sequential, Pack = 1)]
    internal struct WAVEFORMATEXTENSIBLE
    {
        public WAVEFORMATEX Format;
        public ushort wValidBitsPerSample;
        public uint dwChannelMask;
        public Guid SubFormat;
    }

    [ComImport]
    [Guid("A95664D2-9614-4F35-A746-DE8DB63617E6")]
    [InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    internal interface IMMDeviceEnumerator
    {
        [PreserveSig]
        int EnumAudioEndpoints(EDataFlow dataFlow, uint dwStateMask, out IMMDeviceCollection ppDevices);

        [PreserveSig]
        int GetDefaultAudioEndpoint(EDataFlow dataFlow, ERole role, out IMMDevice ppEndpoint);

        [PreserveSig]
        int GetDevice([MarshalAs(UnmanagedType.LPWStr)] string pwstrId, out IMMDevice ppDevice);

        [PreserveSig]
        int RegisterEndpointNotificationCallback(IMMNotificationClient pClient);

        [PreserveSig]
        int UnregisterEndpointNotificationCallback(IMMNotificationClient pClient);
    }

    [ComImport]
    [Guid("0BD7A1BE-7A1A-44DB-8397-CC5392387B5E")]
    [InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    internal interface IMMDeviceCollection
    {
        [PreserveSig]
        int GetCount(out uint pcDevices);

        [PreserveSig]
        int Item(uint nDevice, out IMMDevice ppDevice);
    }

    [ComImport]
    [Guid("D666063F-1587-4E43-81F1-B948E807363F")]
    [InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    internal interface IMMDevice
    {
        [PreserveSig]
        int Activate(ref Guid iid, uint dwClsCtx, IntPtr pActivationParams, [MarshalAs(UnmanagedType.IUnknown)] out object ppInterface);

        [PreserveSig]
        int OpenPropertyStore(uint stgmAccess, out IPropertyStore ppProperties);

        [PreserveSig]
        int GetId([MarshalAs(UnmanagedType.LPWStr)] out string ppstrId);

        [PreserveSig]
        int GetState(out uint pdwState);
    }

    [ComImport]
    [Guid("886d8eeb-8cf2-4446-8d02-cdba1dbdcf99")]
    [InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    internal interface IPropertyStore
    {
        [PreserveSig]
        int GetCount(out uint cProps);

        [PreserveSig]
        int GetAt(uint iProp, out PROPERTYKEY pkey);

        [PreserveSig]
        int GetValue(ref PROPERTYKEY key, out PROPVARIANT pv);
    }

    [ComImport]
    [Guid("7991EEC9-7E89-4D85-8390-6C703CEC60C0")]
    [InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    internal interface IMMNotificationClient
    {
        void OnDeviceStateChanged([MarshalAs(UnmanagedType.LPWStr)] string pwstrDeviceId, uint dwNewState);
        void OnDeviceAdded([MarshalAs(UnmanagedType.LPWStr)] string pwstrDeviceId);
        void OnDeviceRemoved([MarshalAs(UnmanagedType.LPWStr)] string pwstrDeviceId);
        void OnDefaultDeviceChanged(EDataFlow flow, ERole role, [MarshalAs(UnmanagedType.LPWStr)] string pwstrDefaultDeviceId);
        void OnPropertyValueChanged([MarshalAs(UnmanagedType.LPWStr)] string pwstrDeviceId, PROPERTYKEY key);
    }

    [ComImport]
    [Guid("1CB9AD4C-DBFA-4c32-B178-C2F568A703B2")]
    [InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    internal interface IAudioClient
    {
        [PreserveSig]
        int Initialize(AUDCLNT_SHAREMODE ShareMode, uint StreamFlags, long hnsBufferDuration, long hnsPeriodicity, IntPtr pFormat, ref Guid AudioSessionGuid);

        [PreserveSig]
        int GetBufferSize(out uint pNumBufferFrames);

        [PreserveSig]
        int GetStreamLatency(out long phnsLatency);

        [PreserveSig]
        int GetCurrentPadding(out uint pNumPaddingFrames);

        [PreserveSig]
        int IsFormatSupported(AUDCLNT_SHAREMODE ShareMode, IntPtr pFormat, out IntPtr ppClosestMatch);

        [PreserveSig]
        int GetMixFormat(out IntPtr ppDeviceFormat);

        [PreserveSig]
        int GetDevicePeriod(out long phnsDefaultDevicePeriod, out long phnsMinimumDevicePeriod);

        [PreserveSig]
        int Start();

        [PreserveSig]
        int Stop();

        [PreserveSig]
        int Reset();

        [PreserveSig]
        int SetEventHandle(IntPtr eventHandle);

        [PreserveSig]
        int GetService(ref Guid riid, [MarshalAs(UnmanagedType.IUnknown)] out object ppv);
    }

    [ComImport]
    [Guid("C8ADBD64-E71E-48a0-A4DE-185C395CD317")]
    [InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    internal interface IAudioCaptureClient
    {
        [PreserveSig]
        int GetBuffer(out IntPtr ppData, out uint pNumFramesToRead, out uint pdwFlags, out ulong pu64DevicePosition, out ulong pu64QPCPosition);

        [PreserveSig]
        int ReleaseBuffer(uint NumFramesRead);

        [PreserveSig]
        int GetNextPacketSize(out uint pNumFramesInNextPacket);
    }

    internal static class Native
    {
        public static readonly Guid CLSID_MMDeviceEnumerator = new Guid("BCDE0395-E52F-467C-8E3D-C4579291692E");
        public static readonly Guid IID_IAudioClient = new Guid("1CB9AD4C-DBFA-4c32-B178-C2F568A703B2");
        public static readonly Guid IID_IAudioCaptureClient = new Guid("C8ADBD64-E71E-48a0-A4DE-185C395CD317");
        public static readonly Guid KSDATAFORMAT_SUBTYPE_IEEE_FLOAT = new Guid("00000003-0000-0010-8000-00aa00389b71");
        public static readonly Guid KSDATAFORMAT_SUBTYPE_PCM = new Guid("00000001-0000-0010-8000-00aa00389b71");

        public static readonly PROPERTYKEY PKEY_Device_FriendlyName = new PROPERTYKEY
        {
            fmtid = new Guid("A45C254E-DF1C-4EFD-8020-67D146A850E0"),
            pid = 14
        };

        public const uint DEVICE_STATE_ACTIVE = 0x00000001;
        public const uint CLSCTX_ALL = 23;
        public const uint STGM_READ = 0;
        public const uint AUDCLNT_STREAMFLAGS_LOOPBACK = 0x00020000;
        public const uint AUDCLNT_BUFFERFLAGS_SILENT = 0x00000002;
        public const int AUDCLNT_E_DEVICE_INVALIDATED = unchecked((int)0x88890004);

        [DllImport("ole32.dll")]
        public static extern int PropVariantClear(ref PROPVARIANT pvar);

        public static IMMDeviceEnumerator CreateEnumerator()
        {
            Type t = Type.GetTypeFromCLSID(CLSID_MMDeviceEnumerator);
            return (IMMDeviceEnumerator)Activator.CreateInstance(t);
        }

        public static string GetDeviceName(IMMDevice dev)
        {
            IPropertyStore store;
            if (dev.OpenPropertyStore(STGM_READ, out store) != 0 || store == null)
                return "Unknown Device";
            try
            {
                PROPVARIANT pv;
                PROPERTYKEY key = PKEY_Device_FriendlyName;
                if (store.GetValue(ref key, out pv) == 0)
                {
                    try
                    {
                        if (pv.vt == 31 && pv.p != IntPtr.Zero) // VT_LPWSTR
                        {
                            return Marshal.PtrToStringUni(pv.p) ?? "Unknown Device";
                        }
                    }
                    finally
                    {
                        PropVariantClear(ref pv);
                    }
                }
                return "Unknown Device";
            }
            finally
            {
                Marshal.ReleaseComObject(store);
            }
        }
    }

    internal sealed class PcmRingBuffer
    {
        private readonly byte[] _buf;
        private int _readPos;
        private int _writePos;
        private int _count;
        private readonly object _lock = new object();

        public PcmRingBuffer(int capacityBytes)
        {
            _buf = new byte[capacityBytes];
        }

        public void Write(byte[] data, int offset, int len)
        {
            lock (_lock)
            {
                for (int i = 0; i < len; i++)
                {
                    if (_count == _buf.Length)
                    {
                        _readPos = (_readPos + 1) % _buf.Length;
                        _count--;
                    }
                    _buf[_writePos] = data[offset + i];
                    _writePos = (_writePos + 1) % _buf.Length;
                    _count++;
                }
            }
        }

        public int ReadOrSilence(byte[] dest, int offset, int len)
        {
            lock (_lock)
            {
                int toCopy = Math.Min(len, _count);
                for (int i = 0; i < toCopy; i++)
                {
                    dest[offset + i] = _buf[_readPos];
                    _readPos = (_readPos + 1) % _buf.Length;
                }
                _count -= toCopy;
                if (toCopy < len)
                {
                    Array.Clear(dest, offset + toCopy, len - toCopy);
                }
                return toCopy;
            }
        }
    }

    internal sealed class TrackCapture : IMMNotificationClient
    {
        public readonly int TrackIndex;
        public readonly string Label;
        public readonly EDataFlow Flow;
        public readonly ERole Role;
        public readonly bool IsLoopback;
        public readonly string PipeName;
        public string ExplicitDeviceId;

        private readonly PcmRingBuffer _ring = new PcmRingBuffer(48000 * 4 * 2); // 2 seconds max
        private volatile bool _running = true;
        private volatile bool _needsReinit = false;
        private volatile string _activeDeviceName = "";
        private volatile string _activeDeviceId = "";
        private double _lastRms = 0.0;

        private NamedPipeServerStream _pipe;
        private volatile bool _pipeConnected = false;
        private readonly object _pipeLock = new object();

        public TrackCapture(int trackIndex, string label, EDataFlow flow, ERole role, bool isLoopback, string pipeName, string explicitDeviceId)
        {
            TrackIndex = trackIndex;
            Label = label;
            Flow = flow;
            Role = role;
            IsLoopback = isLoopback;
            PipeName = pipeName;
            ExplicitDeviceId = explicitDeviceId;
        }

        public double LastRms { get { return _lastRms; } }
        public string ActiveDeviceName { get { return _activeDeviceName; } }
        public bool PipeConnected { get { return _pipeConnected; } }

        public void Start()
        {
            OpenPipeServer();
            Thread t = new Thread(CaptureLoop);
            t.IsBackground = true;
            t.SetApartmentState(ApartmentState.MTA);
            t.Start();
        }

        public void Stop()
        {
            _running = false;
            lock (_pipeLock)
            {
                try { if (_pipe != null) _pipe.Dispose(); } catch { }
                _pipe = null;
                _pipeConnected = false;
            }
        }

        private void OpenPipeServer()
        {
            lock (_pipeLock)
            {
                try { if (_pipe != null) _pipe.Dispose(); } catch { }
                _pipeConnected = false;
                _pipe = new NamedPipeServerStream(
                    PipeName,
                    PipeDirection.Out,
                    1,
                    PipeTransmissionMode.Byte,
                    PipeOptions.Asynchronous,
                    0,
                    48000 * 4
                );
                _pipe.BeginWaitForConnection(OnPipeConnected, _pipe);
            }
        }

        private void OnPipeConnected(IAsyncResult ar)
        {
            NamedPipeServerStream server = (NamedPipeServerStream)ar.AsyncState;
            lock (_pipeLock)
            {
                if (!_running || server != _pipe) return;
                try
                {
                    server.EndWaitForConnection(ar);
                    _pipeConnected = true;
                    Program.EmitEvent("pipeConnected", TrackIndex, Label, _activeDeviceName);
                }
                catch
                {
                    _pipeConnected = false;
                }
            }
        }

        public void WriteTick(byte[] tickBuf)
        {
            int got = _ring.ReadOrSilence(tickBuf, 0, tickBuf.Length);

            // Compute RMS for telemetry
            double sumSq = 0;
            int samples = tickBuf.Length / 2;
            for (int i = 0; i < tickBuf.Length; i += 2)
            {
                short s = (short)(tickBuf[i] | (tickBuf[i + 1] << 8));
                double norm = s / 32768.0;
                sumSq += norm * norm;
            }
            _lastRms = samples > 0 ? Math.Sqrt(sumSq / samples) : 0.0;

            lock (_pipeLock)
            {
                if (_pipe != null && _pipeConnected)
                {
                    try
                    {
                        _pipe.Write(tickBuf, 0, tickBuf.Length);
                        _pipe.Flush();
                    }
                    catch
                    {
                        _pipeConnected = false;
                        Program.EmitEvent("pipeDisconnected", TrackIndex, Label, _activeDeviceName);
                        OpenPipeServer();
                    }
                }
            }
        }

        private void CaptureLoop()
        {
            IMMDeviceEnumerator enumerator = null;
            try
            {
                enumerator = Native.CreateEnumerator();
                enumerator.RegisterEndpointNotificationCallback(this);
            }
            catch (Exception ex)
            {
                Program.EmitEvent("error", TrackIndex, Label, "Enumerator init failed: " + ex.Message);
            }

            while (_running)
            {
                IMMDevice device = null;
                IAudioClient audioClient = null;
                IAudioCaptureClient captureClient = null;
                IntPtr mixFormatPtr = IntPtr.Zero;

                try
                {
                    if (enumerator == null) enumerator = Native.CreateEnumerator();

                    int hr;
                    if (!string.IsNullOrEmpty(ExplicitDeviceId))
                    {
                        hr = enumerator.GetDevice(ExplicitDeviceId, out device);
                    }
                    else
                    {
                        hr = enumerator.GetDefaultAudioEndpoint(Flow, Role, out device);
                    }

                    if (hr != 0 || device == null)
                    {
                        _activeDeviceName = "";
                        Thread.Sleep(500);
                        continue;
                    }

                    string devId;
                    device.GetId(out devId);
                    _activeDeviceId = devId ?? "";
                    _activeDeviceName = Native.GetDeviceName(device);

                    Guid iidClient = Native.IID_IAudioClient;
                    object objClient;
                    hr = device.Activate(ref iidClient, Native.CLSCTX_ALL, IntPtr.Zero, out objClient);
                    if (hr != 0 || objClient == null)
                    {
                        Thread.Sleep(500);
                        continue;
                    }
                    audioClient = (IAudioClient)objClient;

                    hr = audioClient.GetMixFormat(out mixFormatPtr);
                    if (hr != 0 || mixFormatPtr == null)
                    {
                        Thread.Sleep(500);
                        continue;
                    }

                    WAVEFORMATEX wfx = (WAVEFORMATEX)Marshal.PtrToStructure(mixFormatPtr, typeof(WAVEFORMATEX));
                    bool isFloat = false;
                    if (wfx.wFormatTag == 3)
                    {
                        isFloat = true;
                    }
                    else if (wfx.wFormatTag == 0xFFFE && wfx.cbSize >= 22)
                    {
                        WAVEFORMATEXTENSIBLE wfxe = (WAVEFORMATEXTENSIBLE)Marshal.PtrToStructure(mixFormatPtr, typeof(WAVEFORMATEXTENSIBLE));
                        isFloat = wfxe.SubFormat == Native.KSDATAFORMAT_SUBTYPE_IEEE_FLOAT;
                    }

                    uint flags = IsLoopback ? Native.AUDCLNT_STREAMFLAGS_LOOPBACK : 0;
                    Guid sessionGuid = Guid.Empty;
                    // 100ms shared buffer (in 100ns units)
                    hr = audioClient.Initialize(AUDCLNT_SHAREMODE.AUDCLNT_SHAREMODE_SHARED, flags, 1000000, 0, mixFormatPtr, ref sessionGuid);
                    if (hr != 0)
                    {
                        Thread.Sleep(500);
                        continue;
                    }

                    Guid iidCapture = Native.IID_IAudioCaptureClient;
                    object objCapture;
                    hr = audioClient.GetService(ref iidCapture, out objCapture);
                    if (hr != 0 || objCapture == null)
                    {
                        Thread.Sleep(500);
                        continue;
                    }
                    captureClient = (IAudioCaptureClient)objCapture;

                    hr = audioClient.Start();
                    if (hr != 0)
                    {
                        Thread.Sleep(500);
                        continue;
                    }

                    _needsReinit = false;
                    Program.EmitEvent("trackReady", TrackIndex, Label, _activeDeviceName);

                    int srcRate = (int)wfx.nSamplesPerSec;
                    int srcCh = (int)wfx.nChannels;
                    int srcBits = (int)wfx.wBitsPerSample;
                    int srcAlign = (int)wfx.nBlockAlign;

                    while (_running && !_needsReinit)
                    {
                        uint packetFrames = 0;
                        hr = captureClient.GetNextPacketSize(out packetFrames);
                        if (hr == Native.AUDCLNT_E_DEVICE_INVALIDATED)
                        {
                            Program.EmitEvent("hotSwap", TrackIndex, Label, "Device invalidated, recovering...");
                            break;
                        }
                        if (hr != 0) break;

                        if (packetFrames == 0)
                        {
                            Thread.Sleep(5);
                            continue;
                        }

                        while (packetFrames > 0 && _running && !_needsReinit)
                        {
                            IntPtr dataPtr;
                            uint framesRead;
                            uint bufFlags;
                            ulong devPos;
                            ulong qpcPos;

                            hr = captureClient.GetBuffer(out dataPtr, out framesRead, out bufFlags, out devPos, out qpcPos);
                            if (hr == Native.AUDCLNT_E_DEVICE_INVALIDATED)
                            {
                                _needsReinit = true;
                                Program.EmitEvent("hotSwap", TrackIndex, Label, "Device invalidated during read, recovering...");
                                break;
                            }
                            if (hr != 0) break;

                            try
                            {
                                if (framesRead > 0)
                                {
                                    bool silent = (bufFlags & Native.AUDCLNT_BUFFERFLAGS_SILENT) != 0;
                                    byte[] converted = ConvertTo48kStereoS16(dataPtr, (int)framesRead, srcRate, srcCh, srcBits, srcAlign, isFloat, silent);
                                    _ring.Write(converted, 0, converted.Length);
                                }
                            }
                            finally
                            {
                                captureClient.ReleaseBuffer(framesRead);
                            }

                            hr = captureClient.GetNextPacketSize(out packetFrames);
                            if (hr != 0) break;
                        }
                    }

                    try { audioClient.Stop(); } catch { }
                }
                catch (Exception ex)
                {
                    Program.EmitEvent("error", TrackIndex, Label, ex.Message);
                    Thread.Sleep(500);
                }
                finally
                {
                    if (mixFormatPtr != IntPtr.Zero) Marshal.FreeCoTaskMem(mixFormatPtr);
                    if (captureClient != null) Marshal.ReleaseComObject(captureClient);
                    if (audioClient != null) Marshal.ReleaseComObject(audioClient);
                    if (device != null) Marshal.ReleaseComObject(device);
                }
            }

            if (enumerator != null)
            {
                try { enumerator.UnregisterEndpointNotificationCallback(this); } catch { }
                Marshal.ReleaseComObject(enumerator);
            }
        }

        private static byte[] ConvertTo48kStereoS16(IntPtr ptr, int frames, int srcRate, int srcCh, int srcBits, int srcAlign, bool isFloat, bool silent)
        {
            int dstFrames = srcRate == 48000 ? frames : Math.Max(1, (int)Math.Round(frames * (48000.0 / srcRate)));
            byte[] outBytes = new byte[dstFrames * 4];
            if (silent) return outBytes;

            int rawSize = frames * srcAlign;
            byte[] raw = new byte[rawSize];
            Marshal.Copy(ptr, raw, 0, rawSize);

            for (int df = 0; df < dstFrames; df++)
            {
                int sf = srcRate == 48000 ? df : Math.Min(frames - 1, (int)((long)df * frames / dstFrames));
                int frameOffset = sf * srcAlign;

                float left = 0f;
                float right = 0f;

                if (isFloat && srcBits == 32)
                {
                    left = BitConverter.ToSingle(raw, frameOffset);
                    right = srcCh >= 2 ? BitConverter.ToSingle(raw, frameOffset + 4) : left;
                }
                else if (!isFloat && srcBits == 16)
                {
                    left = BitConverter.ToInt16(raw, frameOffset) / 32768f;
                    right = srcCh >= 2 ? (BitConverter.ToInt16(raw, frameOffset + 2) / 32768f) : left;
                }
                else if (!isFloat && srcBits == 32)
                {
                    left = BitConverter.ToInt32(raw, frameOffset) / 2147483648f;
                    right = srcCh >= 2 ? (BitConverter.ToInt32(raw, frameOffset + 4) / 2147483648f) : left;
                }

                short sL = ClampToInt16(left);
                short sR = ClampToInt16(right);
                int outOff = df * 4;
                outBytes[outOff] = (byte)(sL & 0xFF);
                outBytes[outOff + 1] = (byte)((sL >> 8) & 0xFF);
                outBytes[outOff + 2] = (byte)(sR & 0xFF);
                outBytes[outOff + 3] = (byte)((sR >> 8) & 0xFF);
            }

            return outBytes;
        }

        private static short ClampToInt16(float sample)
        {
            if (sample >= 1.0f) return short.MaxValue;
            if (sample <= -1.0f) return short.MinValue;
            return (short)(sample * 32767f);
        }

        public void OnDeviceStateChanged(string pwstrDeviceId, uint dwNewState)
        {
            if (pwstrDeviceId == _activeDeviceId && dwNewState != Native.DEVICE_STATE_ACTIVE)
            {
                _needsReinit = true;
            }
        }

        public void OnDeviceAdded(string pwstrDeviceId) { }
        public void OnDeviceRemoved(string pwstrDeviceId)
        {
            if (pwstrDeviceId == _activeDeviceId) _needsReinit = true;
        }

        public void OnDefaultDeviceChanged(EDataFlow flow, ERole role, string pwstrDefaultDeviceId)
        {
            if (string.IsNullOrEmpty(ExplicitDeviceId) && flow == Flow && role == Role)
            {
                if (pwstrDefaultDeviceId != _activeDeviceId)
                {
                    Program.EmitEvent("hotSwap", TrackIndex, Label, "Default device changed, switching...");
                    _needsReinit = true;
                }
            }
        }

        public void OnPropertyValueChanged(string pwstrDeviceId, PROPERTYKEY key) { }
    }

    internal static class Program
    {
        private static readonly object _stdoutLock = new object();
        private static volatile bool _stopRequested = false;

        public static void EmitEvent(string type, int track, string label, string message)
        {
            lock (_stdoutLock)
            {
                Console.WriteLine(
                    "{\"type\":\"" + EscapeJson(type) +
                    "\",\"track\":" + track +
                    ",\"label\":\"" + EscapeJson(label) +
                    "\",\"message\":\"" + EscapeJson(message) + "\"}"
                );
            }
        }

        private static string EscapeJson(string s)
        {
            if (string.IsNullOrEmpty(s)) return "";
            StringBuilder sb = new StringBuilder(s.Length);
            foreach (char c in s)
            {
                switch (c)
                {
                    case '\\': sb.Append("\\\\"); break;
                    case '"': sb.Append("\\\""); break;
                    case '\r': sb.Append("\\r"); break;
                    case '\n': sb.Append("\\n"); break;
                    case '\t': sb.Append("\\t"); break;
                    default:
                        if (c < 32) sb.AppendFormat("\\u{0:x4}", (int)c);
                        else sb.Append(c);
                        break;
                }
            }
            return sb.ToString();
        }

        private static int ListDevices()
        {
            IMMDeviceEnumerator enumerator = Native.CreateEnumerator();
            string defaultRenderConsole = GetDefaultId(enumerator, EDataFlow.eRender, ERole.eConsole);
            string defaultRenderComms = GetDefaultId(enumerator, EDataFlow.eRender, ERole.eCommunications);
            string defaultCaptureConsole = GetDefaultId(enumerator, EDataFlow.eCapture, ERole.eConsole);

            List<string> items = new List<string>();
            CollectFlow(enumerator, EDataFlow.eRender, "render", defaultRenderConsole, defaultRenderComms, items);
            CollectFlow(enumerator, EDataFlow.eCapture, "capture", defaultCaptureConsole, "", items);

            Console.WriteLine("[" + string.Join(",", items.ToArray()) + "]");
            Marshal.ReleaseComObject(enumerator);
            return 0;
        }

        private static string GetDefaultId(IMMDeviceEnumerator enumerator, EDataFlow flow, ERole role)
        {
            IMMDevice dev;
            if (enumerator.GetDefaultAudioEndpoint(flow, role, out dev) == 0 && dev != null)
            {
                try
                {
                    string id;
                    dev.GetId(out id);
                    return id ?? "";
                }
                finally
                {
                    Marshal.ReleaseComObject(dev);
                }
            }
            return "";
        }

        private static void CollectFlow(IMMDeviceEnumerator enumerator, EDataFlow flow, string flowName, string defConsole, string defComms, List<string> items)
        {
            IMMDeviceCollection col;
            if (enumerator.EnumAudioEndpoints(flow, Native.DEVICE_STATE_ACTIVE, out col) != 0 || col == null) return;
            try
            {
                uint count;
                col.GetCount(out count);
                for (uint i = 0; i < count; i++)
                {
                    IMMDevice dev;
                    if (col.Item(i, out dev) == 0 && dev != null)
                    {
                        try
                        {
                            string id;
                            dev.GetId(out id);
                            string name = Native.GetDeviceName(dev);
                            bool isConsole = id == defConsole;
                            bool isComms = id == defComms;
                            items.Add(
                                "{\"id\":\"" + EscapeJson(id) +
                                "\",\"name\":\"" + EscapeJson(name) +
                                "\",\"flow\":\"" + flowName +
                                "\",\"isDefaultConsole\":" + (isConsole ? "true" : "false") +
                                ",\"isDefaultComms\":" + (isComms ? "true" : "false") + "}"
                            );
                        }
                        finally
                        {
                            Marshal.ReleaseComObject(dev);
                        }
                    }
                }
            }
            finally
            {
                Marshal.ReleaseComObject(col);
            }
        }

        [MTAThread]
        public static int Main(string[] args)
        {
            bool listMode = false;
            string t1Device = "";
            string t2Device = "";
            string t3Device = "";
            string t1Flow = "render";

            for (int i = 0; i < args.Length; i++)
            {
                if (args[i] == "--list-devices") listMode = true;
                else if ((args[i] == "--t1-device" || args[i] == "--game-device") && i + 1 < args.Length) t1Device = args[++i];
                else if (args[i] == "--t1-capture") t1Flow = "capture";
                else if ((args[i] == "--t2-device" || args[i] == "--comms-device") && i + 1 < args.Length) t2Device = args[++i];
                else if ((args[i] == "--t3-device" || args[i] == "--mic-device") && i + 1 < args.Length) t3Device = args[++i];
            }

            if (listMode)
            {
                return ListDevices();
            }

            bool t1IsCapture = t1Flow == "capture";
            TrackCapture[] tracks = new TrackCapture[]
            {
                new TrackCapture(1, "Game", t1IsCapture ? EDataFlow.eCapture : EDataFlow.eRender, ERole.eConsole, !t1IsCapture, "combocut-audio-t1", t1Device),
                new TrackCapture(2, "Discord", EDataFlow.eRender, ERole.eCommunications, true, "combocut-audio-t2", t2Device),
                new TrackCapture(3, "Mic", EDataFlow.eCapture, ERole.eConsole, false, "combocut-audio-t3", t3Device)
            };

            foreach (TrackCapture t in tracks) t.Start();

            Console.CancelKeyPress += (s, e) =>
            {
                e.Cancel = true;
                _stopRequested = true;
            };

            // 20ms tick = 960 frames @ 48kHz stereo s16le = 3840 bytes
            const int tickMs = 20;
            byte[] tickBuf = new byte[960 * 4];
            Stopwatch sw = Stopwatch.StartNew();
            long nextTickMs = sw.ElapsedMilliseconds;
            long lastTelemetryMs = 0;

            while (!_stopRequested)
            {
                long now = sw.ElapsedMilliseconds;
                if (now < nextTickMs)
                {
                    int sleepMs = (int)(nextTickMs - now);
                    if (sleepMs > 1) Thread.Sleep(sleepMs - 1);
                    continue;
                }

                foreach (TrackCapture t in tracks)
                {
                    t.WriteTick(tickBuf);
                }

                nextTickMs += tickMs;
                if (sw.ElapsedMilliseconds - nextTickMs > 200)
                {
                    nextTickMs = sw.ElapsedMilliseconds;
                }

                if (now - lastTelemetryMs >= 250)
                {
                    lastTelemetryMs = now;
                    lock (_stdoutLock)
                    {
                        Console.WriteLine(
                            string.Format(
                                System.Globalization.CultureInfo.InvariantCulture,
                                "{{\"type\":\"meters\",\"t1\":{0:F4},\"t2\":{1:F4},\"t3\":{2:F4},\"pipes\":[{3},{4},{5}]}}",
                                tracks[0].LastRms,
                                tracks[1].LastRms,
                                tracks[2].LastRms,
                                tracks[0].PipeConnected ? "true" : "false",
                                tracks[1].PipeConnected ? "true" : "false",
                                tracks[2].PipeConnected ? "true" : "false"
                            )
                        );
                    }
                }
            }

            foreach (TrackCapture t in tracks) t.Stop();
            return 0;
        }
    }
}
