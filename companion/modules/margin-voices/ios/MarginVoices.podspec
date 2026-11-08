Pod::Spec.new do |s|
  s.name           = 'MarginVoices'
  s.version        = '1.0.0'
  s.summary        = 'Voice discovery, Personal Voice access and audio session setup for Margin'
  s.description    = 'Local Expo module for the Margin companion app.'
  s.author         = ''
  s.homepage       = 'https://github.com/siddharthshah87/muse'
  s.platforms      = { :ios => '15.1' }
  s.source         = { git: '' }
  s.static_framework = true

  s.dependency 'ExpoModulesCore'

  s.pod_target_xcconfig = {
    'DEFINES_MODULE' => 'YES',
  }

  s.source_files = '**/*.{h,m,mm,swift}'
end
