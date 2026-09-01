export const MINIMAP_VISIBILITY_KEY = 'state-editor.minimap-visible';

type PreferenceStorage = Pick<Storage, 'getItem' | 'setItem'>;

export function readMinimapVisibility(storage: PreferenceStorage) {
  return storage.getItem(MINIMAP_VISIBILITY_KEY) !== 'hidden';
}

export function writeMinimapVisibility(
  storage: PreferenceStorage,
  visible: boolean,
) {
  storage.setItem(MINIMAP_VISIBILITY_KEY, visible ? 'visible' : 'hidden');
}
