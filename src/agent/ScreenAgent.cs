using System;
using System.Drawing;
using System.Drawing.Imaging;
using System.IO;
using System.Net;
using System.Net.Sockets;
using System.Text;
using System.Windows.Forms;

class ScreenAgent {
    static void Main(string[] args) {
        int port = 5000;
        if (args.Length > 0) {
            int.TryParse(args[0], out port);
        }

        // TcpListener nao exige privilegios de Administrador!
        TcpListener listener;
        try {
            listener = new TcpListener(IPAddress.Any, port);
            listener.Start();
        } catch (Exception ex) {
            Console.ForegroundColor = ConsoleColor.Red;
            Console.WriteLine("[ERRO] Nao foi possivel iniciar na porta " + port + ".");
            Console.WriteLine("Detalhe: " + ex.Message);
            Console.WriteLine("\nVerifique se a porta ja esta em uso por outro programa.");
            Console.ResetColor();
            Console.ReadLine();
            return;
        }

        Console.ForegroundColor = ConsoleColor.Cyan;
        Console.WriteLine("==========================================================");
        Console.WriteLine("      PANEL MONITOR - AGENTE DE TRANSMISSAO DE TELA");
        Console.WriteLine("==========================================================");
        Console.ResetColor();
        Console.WriteLine(" Porta: " + port);
        Console.ForegroundColor = ConsoleColor.Green;
        Console.WriteLine(" Status: Rodando e transmitindo!");
        Console.ForegroundColor = ConsoleColor.DarkGray;
        Console.WriteLine(" Pressione Ctrl+C para encerrar.");
        Console.ResetColor();
        Console.WriteLine("----------------------------------------------------------");
        Console.WriteLine(" IPs disponiveis neste computador:");
        foreach (IPAddress addr in Dns.GetHostAddresses(Dns.GetHostName())) {
            if (addr.AddressFamily == AddressFamily.InterNetwork) {
                Console.ForegroundColor = ConsoleColor.Cyan;
                Console.WriteLine("   -> http://" + addr + ":" + port);
                Console.ResetColor();
            }
        }
        Console.WriteLine("----------------------------------------------------------");

        ImageCodecInfo jpegEncoder = GetEncoder(ImageFormat.Jpeg);
        EncoderParameters encoderParams = new EncoderParameters(1);
        encoderParams.Param[0] = new EncoderParameter(System.Drawing.Imaging.Encoder.Quality, 65L);

        while (true) {
            try {
                TcpClient client = listener.AcceptTcpClient();
                System.Threading.ThreadPool.QueueUserWorkItem(HandleClient, client);
            } catch (Exception) {
                // Ignore accept errors
            }
        }
    }

    private static void HandleClient(object state) {
        TcpClient client = (TcpClient)state;
        try {
            NetworkStream stream = client.GetStream();

            // Consume incoming HTTP request
            byte[] reqBuf = new byte[4096];
            stream.ReadTimeout = 500;
            int bytesRead = 0;
            try { 
                bytesRead = stream.Read(reqBuf, 0, reqBuf.Length); 
            } catch {
                return; // Connection closed or reset (e.g. ping test)
            }

            // If it's a ping, it won't send an HTTP request (bytesRead == 0)
            if (bytesRead == 0) {
                return; // Graceful close from client without data
            }
            
            // Parse dimensions from query params if present
            int targetWidth = 0;
            int targetHeight = 0;
            try {
                string requestStr = Encoding.UTF8.GetString(reqBuf, 0, bytesRead);
                int firstLineEnd = requestStr.IndexOf('\r');
                if (firstLineEnd > 0) {
                    string firstLine = requestStr.Substring(0, firstLineEnd);
                    string[] parts = firstLine.Split(' ');
                    if (parts.Length >= 2) {
                        string url = parts[1];
                        int queryIdx = url.IndexOf('?');
                        if (queryIdx >= 0) {
                            string query = url.Substring(queryIdx + 1);
                            string[] queryParts = query.Split('&');
                            foreach (string param in queryParts) {
                                string[] kv = param.Split('=');
                                if (kv.Length == 2) {
                                    if (kv[0] == "w") {
                                        int.TryParse(kv[1], out targetWidth);
                                    } else if (kv[0] == "h") {
                                        int.TryParse(kv[1], out targetHeight);
                                    }
                                }
                            }
                        }
                    }
                }
            } catch (Exception) {
                // Ignore query parsing errors
            }

            // Capture screen
            Rectangle bounds = Screen.PrimaryScreen.Bounds;
            byte[] imageBytes;
            using (Bitmap bmp = new Bitmap(bounds.Width, bounds.Height)) {
                using (Graphics g = Graphics.FromImage(bmp)) {
                    g.CopyFromScreen(bounds.Location, Point.Empty, bounds.Size);
                }

                // Determine target dimensions
                int newWidth = bounds.Width;
                int newHeight = bounds.Height;
                if (targetWidth > 0 && targetWidth < bounds.Width) {
                    newWidth = targetWidth;
                    newHeight = (int)(bounds.Height * ((double)targetWidth / bounds.Width));
                } else if (targetHeight > 0 && targetHeight < bounds.Height) {
                    newHeight = targetHeight;
                    newWidth = (int)(bounds.Width * ((double)targetHeight / bounds.Height));
                }

                if (newWidth != bounds.Width || newHeight != bounds.Height) {
                    using (Bitmap resizedBmp = ResizeImage(bmp, newWidth, newHeight)) {
                        using (MemoryStream ms = new MemoryStream()) {
                            ImageCodecInfo jpegEncoder = GetEncoder(ImageFormat.Jpeg);
                            EncoderParameters encoderParams = new EncoderParameters(1);
                            encoderParams.Param[0] = new EncoderParameter(System.Drawing.Imaging.Encoder.Quality, 80L);
                            resizedBmp.Save(ms, jpegEncoder, encoderParams);
                            imageBytes = ms.ToArray();
                        }
                    }
                } else {
                    using (MemoryStream ms = new MemoryStream()) {
                        ImageCodecInfo jpegEncoder = GetEncoder(ImageFormat.Jpeg);
                        EncoderParameters encoderParams = new EncoderParameters(1);
                        encoderParams.Param[0] = new EncoderParameter(System.Drawing.Imaging.Encoder.Quality, 80L);
                        bmp.Save(ms, jpegEncoder, encoderParams);
                        imageBytes = ms.ToArray();
                    }
                }
            }

            // Write raw HTTP response
            string header =
                "HTTP/1.1 200 OK\r\n" +
                "Content-Type: image/jpeg\r\n" +
                "Content-Length: " + imageBytes.Length + "\r\n" +
                "Access-Control-Allow-Origin: *\r\n" +
                "Cache-Control: no-store, no-cache, must-revalidate\r\n" +
                "Connection: close\r\n\r\n";

            byte[] headerBytes = Encoding.UTF8.GetBytes(header);
            stream.Write(headerBytes, 0, headerBytes.Length);
            stream.Write(imageBytes, 0, imageBytes.Length);
            stream.Flush();

            Console.ForegroundColor = ConsoleColor.DarkGreen;
            Console.WriteLine("[" + DateTime.Now.ToString("HH:mm:ss") + "] Transmitido. (" + (imageBytes.Length / 1024) + " KB) [w=" + (targetWidth > 0 ? targetWidth.ToString() : "original") + "]");
            Console.ResetColor();
        } catch (Exception) {
            // Ignora erros de desconexao do cliente
        } finally {
            try { if (client != null) client.Close(); } catch {}
        }
    }

    private static Bitmap ResizeImage(Image image, int width, int height) {
        Bitmap destImage = new Bitmap(width, height);
        destImage.SetResolution(image.HorizontalResolution, image.VerticalResolution);
        using (Graphics graphics = Graphics.FromImage(destImage)) {
            graphics.CompositingMode = System.Drawing.Drawing2D.CompositingMode.SourceCopy;
            graphics.CompositingQuality = System.Drawing.Drawing2D.CompositingQuality.HighQuality;
            graphics.InterpolationMode = System.Drawing.Drawing2D.InterpolationMode.HighQualityBicubic;
            graphics.SmoothingMode = System.Drawing.Drawing2D.SmoothingMode.HighQuality;
            graphics.PixelOffsetMode = System.Drawing.Drawing2D.PixelOffsetMode.HighQuality;
            using (ImageAttributes wrapMode = new ImageAttributes()) {
                wrapMode.SetWrapMode(System.Drawing.Drawing2D.WrapMode.TileFlipXY);
                graphics.DrawImage(image, new Rectangle(0, 0, width, height), 0, 0, image.Width, image.Height, GraphicsUnit.Pixel, wrapMode);
            }
        }
        return destImage;
    }

    private static ImageCodecInfo GetEncoder(ImageFormat format) {
        foreach (ImageCodecInfo codec in ImageCodecInfo.GetImageDecoders()) {
            if (codec.FormatID == format.Guid) return codec;
        }
        return null;
    }
}
