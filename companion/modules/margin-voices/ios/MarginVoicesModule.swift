import AVFoundation
import ExpoModulesCore

// Voice discovery and audio-session setup for Margin narration.
// expo-speech still does the speaking; this fills the gaps it leaves:
//  - real voice quality (expo-speech reports Premium voices as "Default"),
//  - Personal Voice and novelty-voice traits (iOS 17+),
//  - Personal Voice authorization (iOS 17+),
//  - a spoken-audio playback session so narration continues with the
//    screen locked and ignores the silent switch.
public class MarginVoicesModule: Module {
  public func definition() -> ModuleDefinition {
    Name("MarginVoices")

    Function("getVoices") { () -> [[String: Any]] in
      return AVSpeechSynthesisVoice.speechVoices().map { voice in
        var quality = "default"
        if #available(iOS 16.0, *), voice.quality == .premium {
          quality = "premium"
        } else if voice.quality == .enhanced {
          quality = "enhanced"
        }
        var isPersonalVoice = false
        var isNoveltyVoice = false
        if #available(iOS 17.0, *) {
          isPersonalVoice = voice.voiceTraits.contains(.isPersonalVoice)
          isNoveltyVoice = voice.voiceTraits.contains(.isNoveltyVoice)
        }
        return [
          "identifier": voice.identifier,
          "name": voice.name,
          "language": voice.language,
          "quality": quality,
          "isPersonalVoice": isPersonalVoice,
          "isNoveltyVoice": isNoveltyVoice,
        ]
      }
    }

    Function("getPersonalVoiceAuthorizationStatus") { () -> String in
      if #available(iOS 17.0, *) {
        return MarginVoicesModule.statusName(AVSpeechSynthesizer.personalVoiceAuthorizationStatus)
      }
      return "unsupported"
    }

    AsyncFunction("requestPersonalVoiceAuthorization") { (promise: Promise) in
      if #available(iOS 17.0, *) {
        AVSpeechSynthesizer.requestPersonalVoiceAuthorization { status in
          promise.resolve(MarginVoicesModule.statusName(status))
        }
      } else {
        promise.resolve("unsupported")
      }
    }

    // Category only: the session is activated by the synthesizer when it speaks,
    // so other audio is not interrupted just by opening the app.
    Function("configurePlaybackSession") { () -> Bool in
      do {
        try AVAudioSession.sharedInstance().setCategory(.playback, mode: .spokenAudio, options: [])
        return true
      } catch {
        return false
      }
    }
  }

  @available(iOS 17.0, *)
  private static func statusName(_ status: AVSpeechSynthesizer.PersonalVoiceAuthorizationStatus) -> String {
    switch status {
    case .authorized:
      return "authorized"
    case .denied:
      return "denied"
    case .unsupported:
      return "unsupported"
    case .notDetermined:
      return "notDetermined"
    @unknown default:
      return "unknown"
    }
  }
}
