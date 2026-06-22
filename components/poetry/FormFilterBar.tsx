'use client';

interface Props {
  category: string;
  availableForms: string[];
  selectedForms: string[];
  onChange: (forms: string[]) => void;
}

export function FormFilterBar({ category, availableForms, selectedForms, onChange }: Props) {
  if (availableForms.length === 0) return null;
  const toggle = (form: string) => {
    if (selectedForms.includes(form)) {
      onChange(selectedForms.filter((f) => f !== form));
    } else {
      onChange([...selectedForms, form]);
    }
  };
  return (
    <div className="flex flex-wrap gap-2 my-4" data-category={category}>
      <span className="text-sm text-ink-faint self-center mr-2">体裁：</span>
      {availableForms.map((form) => {
        const isSelected = selectedForms.includes(form);
        return (
          <button
            key={form}
            type="button"
            onClick={() => toggle(form)}
            className={`text-sm px-3 h-8 rounded-full border transition-colors ${
              isSelected
                ? 'bg-ink text-paper border-ink'
                : 'bg-paper text-ink border-ink-faint hover:bg-paper-deep'
            }`}
          >
            {form}
          </button>
        );
      })}
    </div>
  );
}
