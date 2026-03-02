import { Mail, ArrowLeft } from "lucide-react"
import Link from "next/link"
import { Button } from "@/components/ui/button"

export default function VerifyEmailPage() {
  return (
    <div className="min-h-screen bg-gradient-to-br from-pink-50 via-purple-50 to-teal-50 flex items-center justify-center p-4">
      <div className="w-full max-w-md">
        <div className="bg-white rounded-3xl shadow-lg p-8 text-center">
          <div className="w-20 h-20 bg-gradient-to-br from-pink-400 to-purple-400 rounded-full flex items-center justify-center mx-auto mb-6">
            <Mail className="w-10 h-10 text-white" />
          </div>

          <h1 className="text-3xl font-bold text-gray-900 mb-4">Verifica tu Email</h1>

          <p className="text-gray-600 mb-6 leading-relaxed">
            Te hemos enviado un correo de verificación. Por favor revisa tu bandeja de entrada y haz clic en el enlace
            para verificar tu cuenta.
          </p>

          <div className="bg-pink-50 border border-pink-200 rounded-2xl p-4 mb-6">
            <p className="text-sm text-pink-800">
              <strong>Importante:</strong> No podrás iniciar sesión hasta que verifiques tu email. Si no ves el correo,
              revisa tu carpeta de spam.
            </p>
          </div>

          <Link href="/auth/login">
            <Button className="w-full bg-gradient-to-r from-pink-500 to-purple-500 hover:from-pink-600 hover:to-purple-600 text-white rounded-full h-12 text-lg font-semibold">
              <ArrowLeft className="w-5 h-5 mr-2" />
              Volver al Login
            </Button>
          </Link>
        </div>
      </div>
    </div>
  )
}
