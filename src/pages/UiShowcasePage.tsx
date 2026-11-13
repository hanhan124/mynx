import { useState } from "react";
import {
  ActionIcon,
  Alert,
  Badge,
  Button,
  Card,
  Divider,
  Group,
  Menu,
  Modal,
  Notification,
  NumberInput,
  Paper,
  Progress,
  Select,
  SimpleGrid,
  Stack,
  Table,
  Tabs,
  Text,
  TextInput,
  Title,
  Tooltip,
} from "@mantine/core";
import {
  IconAlertCircle,
  IconCheck,
  IconDots,
  IconFlask,
  IconInfoCircle,
  IconSettings,
  IconX,
} from "@tabler/icons-react";
import { useLanguage } from "@/lib/i18n";
import classes from "./UiShowcasePage.module.css";

export default function UiShowcasePage() {
  const { t } = useLanguage();
  const [modalOpened, setModalOpened] = useState(false);
  const [busy, setBusy] = useState(false);
  const [activeTab, setActiveTab] = useState<string | null>("controls");

  const runLoadingDemo = () => {
    setBusy(true);
    window.setTimeout(() => setBusy(false), 1200);
  };

  return (
    <div className={classes.page}>
      <Stack gap="xl" maw={1120} mx="auto">
        <Group justify="space-between" align="flex-start" wrap="nowrap">
          <Stack gap={4}>
            <Badge variant="light" color="scientificBlue" w="fit-content">
              Mantine 8
            </Badge>
            <Title order={1}>{t("uiShowcase.title")}</Title>
            <Text c="dimmed" size="sm">
              {t("uiShowcase.subtitle")}
            </Text>
          </Stack>
          <Tooltip label={t("uiShowcase.settingsTooltip")}>
            <ActionIcon variant="light" color="scientificBlue" size="lg" aria-label={t("uiShowcase.settingsTooltip")}>
              <IconSettings size={18} />
            </ActionIcon>
          </Tooltip>
        </Group>

        <Tabs value={activeTab} onChange={setActiveTab} keepMounted={false}>
          <Tabs.List>
            <Tabs.Tab value="controls" leftSection={<IconFlask size={15} />}>
              {t("uiShowcase.controls")}
            </Tabs.Tab>
            <Tabs.Tab value="feedback" leftSection={<IconInfoCircle size={15} />}>
              {t("uiShowcase.feedback")}
            </Tabs.Tab>
            <Tabs.Tab value="data" leftSection={<IconCheck size={15} />}>
              {t("uiShowcase.data")}
            </Tabs.Tab>
          </Tabs.List>

          <Tabs.Panel value="controls" pt="lg">
            <Stack gap="lg">
              <Section title={t("uiShowcase.buttons")} description={t("uiShowcase.buttonsDescription")}>
                <Group gap="sm" wrap="wrap">
                  <Button color="scientificBlue">{t("uiShowcase.primary")}</Button>
                  <Button variant="light" color="scientificBlue">{t("uiShowcase.secondary")}</Button>
                  <Button variant="subtle" color="scientificBlue">{t("uiShowcase.subtle")}</Button>
                  <Button color="scientificBlue" loading={busy} onClick={runLoadingDemo}>
                    {t("uiShowcase.loading")}
                  </Button>
                  <Button disabled>{t("uiShowcase.disabled")}</Button>
                  <ActionIcon variant="light" color="scientificRed" aria-label={t("uiShowcase.close")}>
                    <IconX size={17} />
                  </ActionIcon>
                  <Menu shadow="sm" width={180}>
                    <Menu.Target>
                      <ActionIcon variant="default" aria-label={t("uiShowcase.menu")}>
                        <IconDots size={17} />
                      </ActionIcon>
                    </Menu.Target>
                    <Menu.Dropdown>
                      <Menu.Label>{t("uiShowcase.menu")}</Menu.Label>
                      <Menu.Item>{t("uiShowcase.menuItemOne")}</Menu.Item>
                      <Menu.Item>{t("uiShowcase.menuItemTwo")}</Menu.Item>
                    </Menu.Dropdown>
                  </Menu>
                </Group>
              </Section>

              <Section title={t("uiShowcase.formControls")} description={t("uiShowcase.formDescription")}>
                <SimpleGrid cols={{ base: 1, sm: 3 }}>
                  <TextInput label={t("uiShowcase.name")} placeholder={t("uiShowcase.namePlaceholder")} />
                  <NumberInput label={t("uiShowcase.number")} defaultValue={3} min={1} max={12} />
                  <Select
                    label={t("uiShowcase.select")}
                    placeholder={t("uiShowcase.selectPlaceholder")}
                    data={["Control", "Treatment", "Reference"]}
                  />
                </SimpleGrid>
                <TextInput
                  label={t("uiShowcase.errorField")}
                  error={t("uiShowcase.errorMessage")}
                  defaultValue="invalid-value"
                />
              </Section>

              <Section title={t("uiShowcase.tabs")} description={t("uiShowcase.tabsDescription")}>
                <Tabs defaultValue="first">
                  <Tabs.List>
                    <Tabs.Tab value="first">{t("uiShowcase.tabOne")}</Tabs.Tab>
                    <Tabs.Tab value="second">{t("uiShowcase.tabTwo")}</Tabs.Tab>
                    <Tabs.Tab value="disabled" disabled>{t("uiShowcase.disabled")}</Tabs.Tab>
                  </Tabs.List>
                </Tabs>
              </Section>
            </Stack>
          </Tabs.Panel>

          <Tabs.Panel value="feedback" pt="lg">
            <Stack gap="lg">
              <Section title={t("uiShowcase.feedbackTitle")} description={t("uiShowcase.feedbackDescription")}>
                <Stack gap="sm">
                  <Alert color="scientificBlue" title={t("uiShowcase.info")} icon={<IconInfoCircle size={18} />}>
                    {t("uiShowcase.infoText")}
                  </Alert>
                  <Alert color="scientificGreen" title={t("uiShowcase.success")} icon={<IconCheck size={18} />}>
                    {t("uiShowcase.successText")}
                  </Alert>
                  <Alert color="scientificOrange" title={t("uiShowcase.warning")} icon={<IconAlertCircle size={18} />}>
                    {t("uiShowcase.warningText")}
                  </Alert>
                  <Notification color="scientificRed" title={t("uiShowcase.notification")} withCloseButton>
                    {t("uiShowcase.notificationText")}
                  </Notification>
                </Stack>
              </Section>
              <Section title={t("uiShowcase.progress")} description={t("uiShowcase.progressDescription")}>
                <Stack gap="xs">
                  <Group justify="space-between"><Text size="sm">{t("uiShowcase.running")}</Text><Text size="sm" c="dimmed">68%</Text></Group>
                  <Progress value={68} color="scientificBlue" animated />
                  <Group justify="space-between"><Text size="sm">{t("uiShowcase.completed")}</Text><Badge color="scientificGreen">100%</Badge></Group>
                </Stack>
              </Section>
              <Button onClick={() => setModalOpened(true)}>{t("uiShowcase.openModal")}</Button>
            </Stack>
          </Tabs.Panel>

          <Tabs.Panel value="data" pt="lg">
            <Paper withBorder radius="md" p="md">
              <Table.ScrollContainer minWidth={560}>
                <Table striped highlightOnHover withColumnBorders={false}>
                  <Table.Thead>
                    <Table.Tr>
                      <Table.Th>{t("uiShowcase.tableSample")}</Table.Th>
                      <Table.Th>{t("uiShowcase.tableStatus")}</Table.Th>
                      <Table.Th>{t("uiShowcase.tableValue")}</Table.Th>
                    </Table.Tr>
                  </Table.Thead>
                  <Table.Tbody>
                    <Table.Tr><Table.Td>Control</Table.Td><Table.Td><Badge color="scientificGreen">{t("uiShowcase.completed")}</Badge></Table.Td><Table.Td>1.00</Table.Td></Table.Tr>
                    <Table.Tr><Table.Td>Treatment A</Table.Td><Table.Td><Badge color="scientificBlue">{t("uiShowcase.running")}</Badge></Table.Td><Table.Td>2.41</Table.Td></Table.Tr>
                    <Table.Tr><Table.Td>Treatment B</Table.Td><Table.Td><Badge color="scientificRed">{t("uiShowcase.failed")}</Badge></Table.Td><Table.Td>—</Table.Td></Table.Tr>
                  </Table.Tbody>
                </Table>
              </Table.ScrollContainer>
            </Paper>
          </Tabs.Panel>
        </Tabs>
      </Stack>

      <Modal opened={modalOpened} onClose={() => setModalOpened(false)} title={t("uiShowcase.modalTitle")}>
        <Stack gap="md">
          <Text size="sm">{t("uiShowcase.modalText")}</Text>
          <Group justify="flex-end">
            <Button variant="default" onClick={() => setModalOpened(false)}>{t("uiShowcase.cancel")}</Button>
            <Button onClick={() => setModalOpened(false)}>{t("uiShowcase.confirm")}</Button>
          </Group>
        </Stack>
      </Modal>
    </div>
  );
}

function Section({ title, description, children }: { title: string; description: string; children: React.ReactNode }) {
  return (
    <Card withBorder radius="md" padding="lg">
      <Stack gap="md">
        <Stack gap={2}>
          <Title order={3}>{title}</Title>
          <Text size="sm" c="dimmed">{description}</Text>
        </Stack>
        <Divider />
        {children}
      </Stack>
    </Card>
  );
}
