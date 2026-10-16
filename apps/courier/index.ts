// The background location task must be defined before anything else: Android may start the
// app only to deliver a position, without the screens (D050).
import './src/lib/tracking';
import { registerRootComponent } from 'expo';
import App from './App';

registerRootComponent(App);
