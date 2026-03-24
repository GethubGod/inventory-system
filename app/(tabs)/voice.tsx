import React from 'react';
import { Redirect } from 'expo-router';

export default function VoiceScreen() {
  // Keep the employee route in place for launch stability, but do not expose
  // the Smart Order page in employee mode.
  return <Redirect href="/(tabs)" />;
}
