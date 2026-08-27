import { create } from 'zustand';

export const useToastStore = create((set) => ({
  items: [],
  push: (message, tone = 'success') => {
    const id = crypto.randomUUID();
    set((state) => ({ items: [...state.items, { id, message, tone }] }));
    window.setTimeout(
      () =>
        set((state) => ({
          items: state.items.filter((item) => item.id !== id),
        })),
      3_500
    );
  },
}));
