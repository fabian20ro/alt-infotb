import { mount } from 'svelte';
import '../../src/app.css';
import MapTouch from './MapTouch.svelte';

mount(MapTouch, { target: document.getElementById('app')! });
