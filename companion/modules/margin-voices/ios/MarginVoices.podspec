Pod::Spec.new do |s|
  s.name           = 'MarginVoices'
  s.version        = '1.0.0'
  s.summary        = 'Voice discovery, Personal Voice access and audio session setup for Margin'
  s.description    = 'Local Expo module for the Margin companion app.'
  s.author         = ''
  s.homepage       = 'https://github.com/siddharthshah87/muse'
  # Matches Expo SDK 55's own minimum; the app itself targets iOS 17 (app.json).
  s.platforms      = { :ios => '15.1' }
  # ExpoModulesCore is Swift 6 from SDK 55; keep this module in Swift 5 language
  # mode like Expo's own modules (e.g. ExpoSpeech) to avoid strict-concurrency errors.
  s.swift_version  = '5.9'
  s.source         = { git: '' }
  s.static_framework = true

  s.dependency 'ExpoModulesCore'

  s.pod_target_xcconfig = {
    'DEFINES_MODULE' => 'YES',
  }

  s.source_files = '**/*.{h,m,mm,swift}'
end
