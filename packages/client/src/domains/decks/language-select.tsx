import { trpc } from "../../infra/trpc"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "../../ui/select"

interface Props {
  value: string
  onChange: (next: string) => void
  disabledValue?: string
  placeholder?: string
}

export function LanguageSelect({
  value,
  onChange,
  disabledValue,
  placeholder = "Choose language",
}: Props) {
  const languages = trpc.languages.list.useQuery()
  return (
    <Select value={value} onValueChange={onChange} disabled={languages.isLoading}>
      <SelectTrigger>
        <SelectValue placeholder={placeholder} />
      </SelectTrigger>
      <SelectContent>
        {languages.data?.map((language) => (
          <SelectItem
            key={language.id}
            value={String(language.id)}
            disabled={!!disabledValue && String(language.id) === disabledValue}
          >
            {language.emoji} {language.name}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  )
}
