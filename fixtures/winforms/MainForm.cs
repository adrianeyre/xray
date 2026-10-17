namespace Greeter;

public partial class MainForm : Form
{
    private int greetings;

    public MainForm()
    {
        InitializeComponent();
    }

    private void greetButton_Click(object sender, EventArgs e)
    {
        greetings++;
        var name = nameBox.Text.Trim();
        greetingLabel.Text = name.Length == 0
            ? "Hello, whoever you are!"
            : $"Hello, {name}! (greeting {greetings})";
    }

    private void nameBox_TextChanged(object sender, EventArgs e)
    {
        greetButton.Enabled = nameBox.TextLength <= 40;
    }
}
