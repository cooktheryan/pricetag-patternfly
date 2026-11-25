import { Flex, FlexItem } from '@patternfly/react-core'
import logo from '../assets/red-hat-logo.svg'

/** Red Hat hat mark + product name, as used across Red Hat console products. */
export function Brand() {
  return (
    <Flex spaceItems={{ default: 'spaceItemsSm' }} alignItems={{ default: 'alignItemsCenter' }}>
      <FlexItem>
        <img src={logo} alt="Red Hat" height={28} />
      </FlexItem>
      <FlexItem className="app-brand-name">PriceTag</FlexItem>
    </Flex>
  )
}
