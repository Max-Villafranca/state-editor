import { createRoot } from 'react-dom/client';

import '@/src/globals.css';
import { MachineEditor } from '@/components/machine-editor';

const root = document.getElementById('root');

if (!root) {
  throw new Error('State Editor could not find its application root.');
}

createRoot(root).render(<MachineEditor />);
