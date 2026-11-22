// Lists the audio sessions of the default playback device that are active (playing) right now, with their process.
// Core Audio: IMMDeviceEnumerator -> IMMDevice -> IAudioSessionManager2 -> IAudioSessionEnumerator -> IAudioSessionControl2
using System;
using System.Collections.Generic;
using System.Runtime.InteropServices;

public static class AudioWatch {
	[ComImport, Guid("BCDE0395-E52F-467C-8E3D-C4579291692E")] class MMDeviceEnumerator {}

	[Guid("A95664D2-9614-4F35-A746-DE8DB63617E6"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
	interface IMMDeviceEnumerator {
		[PreserveSig] int EnumAudioEndpoints(int dataFlow, int stateMask, out IntPtr devices);
		[PreserveSig] int GetDefaultAudioEndpoint(int dataFlow, int role, out IMMDevice device);
	}

	[Guid("D666063F-1587-4E43-81F1-B948E807363F"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
	interface IMMDevice {
		[PreserveSig] int Activate(ref Guid iid, int clsCtx, IntPtr activationParams, [MarshalAs(UnmanagedType.IUnknown)] out object iface);
	}

	[Guid("77AA99A0-1BD6-484F-8BC7-2C654C9A9B6F"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
	interface IAudioSessionManager2 {
		[PreserveSig] int GetAudioSessionControl(IntPtr a, int b, out IntPtr c);
		[PreserveSig] int GetSimpleAudioVolume(IntPtr a, int b, out IntPtr c);
		[PreserveSig] int GetSessionEnumerator(out IAudioSessionEnumerator sessions);
	}

	[Guid("E2F5BB11-0570-40CA-ACDD-3AA01277DEE8"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
	interface IAudioSessionEnumerator {
		[PreserveSig] int GetCount(out int count);
		[PreserveSig] int GetSession(int index, out IAudioSessionControl2 session);
	}

	[Guid("bfb7ff88-7239-4fc9-8fa2-07c950be9c6d"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
	interface IAudioSessionControl2 {
		[PreserveSig] int GetState(out int state);
		[PreserveSig] int GetDisplayName([MarshalAs(UnmanagedType.LPWStr)] out string name);
		[PreserveSig] int SetDisplayName(IntPtr a, IntPtr b);
		[PreserveSig] int GetIconPath(IntPtr a);
		[PreserveSig] int SetIconPath(IntPtr a, IntPtr b);
		[PreserveSig] int GetGroupingParam(IntPtr a);
		[PreserveSig] int SetGroupingParam(IntPtr a, IntPtr b);
		[PreserveSig] int RegisterAudioSessionNotification(IntPtr a);
		[PreserveSig] int UnregisterAudioSessionNotification(IntPtr a);
		[PreserveSig] int GetSessionIdentifier([MarshalAs(UnmanagedType.LPWStr)] out string id);
		[PreserveSig] int GetSessionInstanceIdentifier([MarshalAs(UnmanagedType.LPWStr)] out string id);
		[PreserveSig] int GetProcessId(out uint pid);
		[PreserveSig] int IsSystemSoundsSession();
	}

	[Guid("C02216F6-8C67-4B5B-9D00-D008E73E0064"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
	interface IAudioMeterInformation {
		[PreserveSig] int GetPeakValue(out float peak);
	}

	/** "pid|isSystemSounds|peak" for each session that is playing now (AudioSessionStateActive = 1); peak 0..1 is the signal level */
	public static List<string> ActiveSessions() {
		var result = new List<string>();
		var enumerator = (IMMDeviceEnumerator)new MMDeviceEnumerator();
		IMMDevice device;
		if(enumerator.GetDefaultAudioEndpoint(0 /* eRender */, 1 /* eMultimedia */, out device) != 0)
			return result;
		Guid iid = typeof(IAudioSessionManager2).GUID;
		object o;
		device.Activate(ref iid, 23 /* CLSCTX_ALL */, IntPtr.Zero, out o);
		IAudioSessionEnumerator sessions;
		((IAudioSessionManager2)o).GetSessionEnumerator(out sessions);
		int count;
		sessions.GetCount(out count);
		for(int i = 0; i < count; i++) {
			IAudioSessionControl2 s;
			sessions.GetSession(i, out s);
			int state;
			s.GetState(out state);
			if(state != 1)
				continue;
			uint pid;
			s.GetProcessId(out pid);
			float peak = -1;
			var meter = s as IAudioMeterInformation;
			if(meter != null)
				meter.GetPeakValue(out peak);
			result.Add(pid + "|" + (s.IsSystemSoundsSession() == 0 ? "system-sounds" : "app") + "|" + peak.ToString("0.00000", System.Globalization.CultureInfo.InvariantCulture));
		}
		return result;
	}
}
