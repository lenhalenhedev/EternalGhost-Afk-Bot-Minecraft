import { create } from 'zustand';
import { createUuid } from '../lib/uuid';

export const useToastStore = create((set) => ({
  items: [],
  modal: null,
  push: (message, tone = 'success') => {
    const id = createUuid();
    set((state) => ({ items: [...state.items, { id, message, tone }] }));
    window.setTimeout(
      () =>
        set((state) => ({
          items: state.items.filter((item) => item.id !== id),
        })),
      3_500
    );
  },
  openModal: (modal) => set({ modal }),
  closeModal: () => set({ modal: null }),
}));
