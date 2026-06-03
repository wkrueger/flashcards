import { trpc } from "../../infra/trpc"
import { NativeSelect } from "../../ui/NativeSelect"

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
  const options =
    languages.data?.map((l) => ({
      value: String(l.id),
      label: `${l.emoji} ${l.name}`,
      disabled: !!disabledValue && String(l.id) === disabledValue,
    })) ?? []

  return (
    <NativeSelect
      value={value}
      onChange={onChange}
      options={options}
      placeholder={placeholder}
      disabled={languages.isLoading}
    />
  )
}
